package controllers

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestRefreshLifecycle(t *testing.T) {
	s, _ := testServer(t)
	now := time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	w := req(s, "POST", "/api/v1/auth/register", map[string]string{"email": "refresh@example.com", "password": "correct horse battery"}, nil, "")
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body)
	}
	cookies := w.Result().Cookies()
	if len(cookies) < 2 {
		t.Fatalf("want access and refresh cookies, got %d", len(cookies))
	}
	access, refresh := cookies[0], cookies[1]
	if access.MaxAge != 3600 || refresh.MaxAge != 30*24*3600 || !refresh.HttpOnly || refresh.Path != "/api/v1/auth" {
		t.Fatal("incorrect credential lifetimes or flags", cookies)
	}
	now = now.Add(2 * time.Hour)
	if w = req(s, "GET", "/api/v1/auth/me", nil, access, ""); w.Code != 401 {
		t.Fatal("expired access accepted")
	}
	original := refresh
	for i := 0; i < 5; i++ {
		w = req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, refresh, "")
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		next := w.Result().Cookies()
		if next[1].Value == refresh.Value {
			t.Fatal("refresh did not rotate")
		}
		access, refresh = next[0], next[1]
		if w = req(s, "GET", "/api/v1/auth/me", nil, access, ""); w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		now = now.Add(25 * 24 * time.Hour)
	}
	// No absolute 90-day cap: five renewals above reached day 100.
	w = req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, original, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatal("old token replay accepted", w.Code)
	}
	if w = req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, refresh, ""); w.Code != 401 {
		t.Fatal("reused family not revoked", w.Code)
	}
}

func TestRefreshIdleExpiryAndConcurrentRetry(t *testing.T) {
	s, _ := testServer(t)
	now := time.Now().UTC()
	s.now = func() time.Time { return now }
	w := req(s, "POST", "/api/v1/auth/register", map[string]string{"email": "idle@example.com", "password": "correct horse battery"}, nil, "")
	if len(w.Result().Cookies()) < 2 {
		t.Fatal("missing refresh cookie")
	}
	old := w.Result().Cookies()[1]
	w = req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, old, "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	// Lost-response retry / parallel tab within grace stays usable.
	w = req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, old, "")
	if w.Code != 200 {
		t.Fatal("concurrent retry rejected", w.Code, w.Body)
	}
	fresh := w.Result().Cookies()[1]
	now = now.Add(30 * 24 * time.Hour)
	if w = req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, fresh, ""); w.Code != 401 {
		t.Fatal("idle expiry accepted", w.Code)
	}
}

func TestBrowserIdentitySurvivesLogin(t *testing.T) {
	s, pool := testServer(t)
	w := req(s, "POST", "/api/v1/auth/register", map[string]string{"email": "browser@example.com", "password": "correct horse battery"}, nil, "")
	var browser *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "focus_device" {
			browser = c
		}
	}
	if browser == nil {
		t.Fatal("missing persistent browser identity")
	}
	_, err := pool.Exec(context.Background(), `INSERT INTO push_subscriptions(id,user_id,session_id,endpoint,p256dh,auth,created_at,device_name)
 SELECT '00000000-0000-4000-8000-000000000001',user_id,id,'https://fcm.googleapis.com/fcm/send/browser-test','key','auth',now(),'Chrome · macOS' FROM auth_sessions`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), "UPDATE auth_sessions SET expires_at=now()-interval '31 days',refresh_expires_at=now()-interval '1 day'"); err != nil {
		t.Fatal(err)
	}
	w = req(s, "POST", "/api/v1/auth/login", map[string]string{"email": "browser@example.com", "password": "correct horse battery"}, browser, "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	var count int
	if err := pool.QueryRow(context.Background(), "SELECT count(DISTINCT browser_id) FROM auth_sessions").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("browser identity changed at login", count)
	}
	access := w.Result().Cookies()[0]
	body := object(t, w, 200)
	state := object(t, req(s, "GET", "/api/v1/notifications", nil, access, ""), 200)
	devices := state["subscriptions"].([]any)
	if len(devices) != 1 || devices[0].(map[string]any)["currentDevice"] != true {
		t.Fatal("existing consent did not follow browser", state)
	}
	object(t, req(s, "POST", "/api/v1/auth/logout", map[string]any{}, access, body["csrfToken"].(string)), 200)
	refresh := w.Result().Cookies()[1]
	if got := req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, refresh, ""); got.Code != 401 {
		t.Fatal("logout left refresh usable")
	}
	w = req(s, "POST", "/api/v1/auth/login", map[string]string{"email": "browser@example.com", "password": "correct horse battery"}, browser, "")
	object(t, w, 200)
	state = object(t, req(s, "GET", "/api/v1/notifications", nil, w.Result().Cookies()[0], ""), 200)
	if len(state["subscriptions"].([]any)) != 0 {
		t.Fatal("login restored consent revoked by logout", state)
	}

}

// Both network responses may finish in either order; either cookie pair must
// remain usable after the retry grace has elapsed.
func TestRefreshResponsesCanArriveOutOfOrder(t *testing.T) {
	s, _ := testServer(t)
	now := time.Now().UTC()
	s.now = func() time.Time { return now }
	w := req(s, "POST", "/api/v1/auth/register", map[string]string{"email": "race@example.com", "password": "correct horse battery"}, nil, "")
	original := w.Result().Cookies()[1]
	responses := make(chan []*http.Cookie, 2)
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		go func() {
			r := req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, original, "")
			codes <- r.Code
			responses <- r.Result().Cookies()
		}()
	}
	first, second := <-responses, <-responses
	for i := 0; i < 2; i++ {
		if code := <-codes; code != http.StatusOK {
			t.Fatalf("parallel refresh failed: status %d", code)
		}
	}
	if first[0].Value != second[0].Value || first[1].Value != second[1].Value {
		t.Error("parallel refresh returned different credentials")
	}
	// A new request using the successor during grace must not invalidate the
	// response still in flight from the first pair of requests.
	object(t, req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, second[1], ""), 200)
	if got := req(s, "GET", "/api/v1/auth/me", nil, first[0], ""); got.Code != 200 {
		t.Error("late access response became invalid")
	}
	now = now.Add(time.Hour)
	object(t, req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, first[1], ""), 200)
}

func TestAccountSwitchRevokesPreviousBrowserConsent(t *testing.T) {
	s, pool := testServer(t)
	ctx := context.Background()
	w := req(s, "POST", "/api/v1/auth/register", map[string]string{"email": "owner@example.com", "password": "correct horse battery"}, nil, "")
	var browser *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "focus_device" {
			browser = c
		}
	}
	if browser == nil {
		t.Fatal("missing browser")
	}
	_, err := pool.Exec(ctx, `INSERT INTO push_subscriptions(id,user_id,session_id,endpoint,p256dh,auth,created_at) SELECT gen_random_uuid(),user_id,id,'https://fcm.googleapis.com/fcm/send/switch','key','auth',now() FROM auth_sessions`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `UPDATE auth_sessions SET expires_at=now()-interval '31 days',refresh_expires_at=now()-interval '1 day'`)
	if err != nil {
		t.Fatal(err)
	}
	// A separate browser for the same owner must keep its notification consent.
	object(t, req(s, "POST", "/api/v1/auth/login", map[string]string{"email": "owner@example.com", "password": "correct horse battery"}, nil, ""), 200)
	_, err = pool.Exec(ctx, `INSERT INTO push_subscriptions(id,user_id,session_id,endpoint,p256dh,auth,created_at) SELECT gen_random_uuid(),user_id,id,'https://fcm.googleapis.com/fcm/send/other-browser','key','auth',now() FROM auth_sessions WHERE browser_id<>$1::uuid`, browser.Value)
	if err != nil {
		t.Fatal(err)
	}
	register(t, s, "other@example.com")
	// A failed login must not revoke another account's consent.
	req(s, "POST", "/api/v1/auth/login", map[string]string{"email": "other@example.com", "password": "wrong password"}, browser, "")
	var active int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM push_subscriptions WHERE revoked_at IS NULL").Scan(&active); err != nil {
		t.Fatal(err)
	}
	if active != 2 {
		t.Fatal("failed login revoked consent")
	}
	object(t, req(s, "POST", "/api/v1/auth/login", map[string]string{"email": "other@example.com", "password": "correct horse battery"}, browser, ""), 200)
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM push_subscriptions WHERE revoked_at IS NULL").Scan(&active); err != nil {
		t.Fatal(err)
	}
	if active != 1 {
		t.Fatal("old account still enrolled on shared browser")
	}
	var otherBrowserActive bool
	if err := pool.QueryRow(ctx, "SELECT revoked_at IS NULL FROM push_subscriptions WHERE endpoint='https://fcm.googleapis.com/fcm/send/other-browser'").Scan(&otherBrowserActive); err != nil {
		t.Fatal(err)
	}
	if !otherBrowserActive {
		t.Fatal("account switch revoked another browser")
	}

	object(t, req(s, "POST", "/api/v1/auth/login", map[string]string{"email": "owner@example.com", "password": "correct horse battery"}, browser, ""), 200)
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM push_subscriptions WHERE revoked_at IS NULL").Scan(&active); err != nil {
		t.Fatal(err)
	}
	if active != 1 {
		t.Fatal("switching back resurrected revoked consent")
	}
}
