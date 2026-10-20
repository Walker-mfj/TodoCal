package server

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func testServer(t *testing.T) (*Server, *pgxpool.Pool) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	p, e := pgxpool.New(context.Background(), url)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(p.Close)
	if !strings.HasSuffix(p.Config().ConnConfig.Database, "_test") {
		t.Fatal("refusing to reset a database without _test suffix")
	}
	if e = Migrate(context.Background(), p); e != nil {
		t.Fatal(e)
	}
	_, e = p.Exec(context.Background(), "TRUNCATE users, auth_attempts CASCADE")
	if e != nil {
		t.Fatal(e)
	}
	return New(p, "http://localhost:3000", false), p
}
func req(s *Server, method, path string, body any, cookie *http.Cookie, csrf string) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	r := httptest.NewRequest(method, path, bytes.NewReader(b))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "http://localhost:3000")
	r.Header.Set("X-CSRF-Token", csrf)
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}
func register(t *testing.T, s *Server, email string) (*http.Cookie, string) {
	t.Helper()
	w := req(s, "POST", "/api/v1/auth/register", map[string]string{"email": email, "password": "correct horse battery"}, nil, "")
	if w.Code != 201 {
		t.Fatalf("register %d %s", w.Code, w.Body)
	}
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	return w.Result().Cookies()[0], out["csrfToken"].(string)
}
func TestAuthLifecycle(t *testing.T) {
	s, p := testServer(t)
	c, csrf := register(t, s, "first@example.com")
	if !c.HttpOnly || c.SameSite != http.SameSiteLaxMode {
		t.Fatal("unsafe cookie")
	}
	if w := req(s, "GET", "/api/v1/auth/me", nil, c, ""); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := req(s, "POST", "/api/v1/auth/logout", nil, c, ""); w.Code != 403 {
		t.Fatal("missing CSRF accepted", w.Code)
	}
	if w := req(s, "POST", "/api/v1/auth/login", map[string]string{"email": "first@example.com", "password": "incorrect password"}, nil, ""); w.Code != 401 {
		t.Fatal(w.Code)
	}
	w := req(s, "POST", "/api/v1/auth/login", map[string]string{"email": "first@example.com", "password": "correct horse battery"}, nil, "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	other := w.Result().Cookies()[0]
	if w := req(s, "POST", "/api/v1/auth/password", map[string]string{"oldPassword": "correct horse battery", "newPassword": "another strong password"}, c, csrf); w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	if w := req(s, "GET", "/api/v1/auth/me", nil, other, ""); w.Code != 401 {
		t.Fatal("other session not revoked")
	}
	if w := req(s, "POST", "/api/v1/auth/logout", nil, c, csrf); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := req(s, "GET", "/api/v1/auth/me", nil, c, ""); w.Code != 401 {
		t.Fatal("logout ineffective")
	}
	c, _ = register(t, s, "expired@example.com")
	p.Exec(context.Background(), "UPDATE auth_sessions SET expires_at=now()-interval '1 hour'")
	if w := req(s, "GET", "/api/v1/auth/me", nil, c, ""); w.Code != 401 {
		t.Fatal("expired accepted")
	}
}
func TestAuthValidationAndOrigin(t *testing.T) {
	s, _ := testServer(t)
	register(t, s, "first@example.com")
	for _, b := range []map[string]string{{"email": "bad", "password": "correct horse battery"}, {"email": "short@example.com", "password": "short"}} {
		if w := req(s, "POST", "/api/v1/auth/register", b, nil, ""); w.Code != 422 {
			t.Fatal(w.Code)
		}
	}
	if w := req(s, "POST", "/api/v1/auth/register", map[string]string{"email": "FIRST@example.com", "password": "correct horse battery"}, nil, ""); w.Code != 409 {
		t.Fatal(w.Code)
	}
	r := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewBufferString(`{}`))
	r.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("origin accepted")
	}
	for i := 0; i < 11; i++ {
		w = req(s, "POST", "/api/v1/auth/login", map[string]string{"email": "unknown@example.com", "password": "correct horse battery"}, nil, "")
	}
	if w.Code != 429 {
		t.Fatal("no rate limit", w.Code)
	}
}

func TestAuthIdentityDefaultsAndSecretStorage(t *testing.T) {
	s, p := testServer(t)
	for _, c := range []*http.Cookie{nil, {Name: "focus_session", Value: strings.Repeat("0", 64)}} {
		if w := req(s, "GET", "/api/v1/auth/me", nil, c, ""); w.Code != 401 {
			t.Fatalf("invalid session accepted: %d", w.Code)
		}
	}
	c, csrf := register(t, s, "private@example.com")
	w := req(s, "GET", "/api/v1/auth/me", nil, c, "")
	var out struct {
		User     User   `json:"user"`
		CSRF     string `json:"csrfToken"`
		Settings struct {
			Timezone   string `json:"timezone"`
			Appearance string `json:"appearance"`
			Focus      int    `json:"focusMinutes"`
			Short      int    `json:"shortBreakMinutes"`
			Long       int    `json:"longBreakMinutes"`
		} `json:"settings"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.User.Email != "private@example.com" || out.CSRF != csrf || out.Settings.Timezone != "UTC" || out.Settings.Appearance != "light" || out.Settings.Focus != 25 || out.Settings.Short != 5 || out.Settings.Long != 15 {
		t.Fatal("incorrect account defaults")
	}
	var passwordHash, sessionHash, csrfHash string
	err := p.QueryRow(context.Background(), `SELECT password_hash,token_hash,csrf_hash FROM users JOIN auth_sessions ON users.id=auth_sessions.user_id WHERE users.id=$1`, out.User.ID).Scan(&passwordHash, &sessionHash, &csrfHash)
	if err != nil {
		t.Fatal(err)
	}
	if passwordHash == "correct horse battery" || sessionHash == c.Value || csrfHash == csrf {
		t.Fatal("plaintext secret persisted")
	}
	for _, secret := range []string{passwordHash, sessionHash, csrfHash, c.Value, "correct horse battery"} {
		if strings.Contains(w.Body.String(), secret) {
			t.Fatal("private secret exposed in account response")
		}
	}
	var messages []string
	for _, email := range []string{"private@example.com", "missing@example.com"} {
		w = req(s, "POST", "/api/v1/auth/login", map[string]string{"email": email, "password": "incorrect password"}, nil, "")
		if w.Code != 401 {
			t.Fatal(w.Code)
		}
		var body struct {
			Error struct{ Code, Message, RequestID string } `json:"error"`
		}
		if err = json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Error.RequestID == "" {
			t.Fatal("missing request identifier")
		}
		messages = append(messages, body.Error.Message)
	}
	if messages[0] != messages[1] {
		t.Fatal("login error reveals account existence")
	}
}

func TestRegistrationRollsBackAndRedactsDatabaseFailures(t *testing.T) {
	s, p := testServer(t)
	_, err := p.Exec(context.Background(), `ALTER TABLE settings ADD CONSTRAINT test_reject_settings CHECK(false) NOT VALID`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, e := p.Exec(context.Background(), `ALTER TABLE settings DROP CONSTRAINT test_reject_settings`); e != nil {
			t.Error(e)
		}
	})
	var logs bytes.Buffer
	prior := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prior) })
	w := req(s, "POST", "/api/v1/auth/register", map[string]string{"email": "rollback@example.com", "password": "private rollback password"}, nil, "")
	if w.Code != 500 {
		t.Fatal(w.Code, w.Body)
	}
	var users, sessions int
	if err = p.QueryRow(context.Background(), `SELECT count(*) FROM users`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if err = p.QueryRow(context.Background(), `SELECT count(*) FROM auth_sessions`).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if users != 0 || sessions != 0 || len(w.Result().Cookies()) != 0 {
		t.Fatal("failed registration left partial account/session")
	}
	for _, secret := range []string{"rollback@example.com", "private rollback password", "test_reject_settings", "password_hash"} {
		if strings.Contains(w.Body.String()+logs.String(), secret) {
			t.Fatal("database detail or credentials exposed")
		}
	}
	if !strings.Contains(logs.String(), w.Header().Get("X-Request-ID")) {
		t.Fatal("failure cannot be correlated")
	}
}
