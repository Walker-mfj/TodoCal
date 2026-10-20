package server

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}
type Principal struct {
	User
	SessionID string
	CSRFHash  string
	Token     string
}
type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Timezone string `json:"timezone,omitempty"`
}

func normalizedEmail(v string) (string, bool) {
	v = strings.ToLower(strings.TrimSpace(v))
	a, e := mail.ParseAddress(v)
	return v, e == nil && a.Address == v && len(v) <= 254
}
func (s *Server) limited(w http.ResponseWriter, r *http.Request, email string) bool {
	ip, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil {
		ip = r.RemoteAddr
	}
	// Do not trust X-Forwarded-For from arbitrary clients.
	for _, key := range []string{"email:" + tokenHash(email), "ip:" + tokenHash(ip)} {
		limit := 10
		if strings.HasPrefix(key, "ip:") {
			limit = 60
		}
		var count int
		e := s.pool.QueryRow(r.Context(), `INSERT INTO auth_attempts(key,attempts,window_start) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_attempts.window_start < $2::timestamptz-interval '15 minutes' THEN 1 ELSE auth_attempts.attempts+1 END, window_start=CASE WHEN auth_attempts.window_start < $2::timestamptz-interval '15 minutes' THEN $2 ELSE auth_attempts.window_start END RETURNING attempts`, key, s.now()).Scan(&count)
		if e != nil {
			internal(w, e)
			return true
		}
		if count > limit {
			w.Header().Set("Retry-After", "900")
			fail(w, 429, "rate_limit", "Too many attempts. Please try again later.")
			return true
		}
	}
	return false
}
func (s *Server) createSession(ctx context.Context, tx pgx.Tx, userID string) (string, string, error) {
	token := randomToken(32)
	csrf := tokenHash("csrf:" + token)
	_, e := tx.Exec(ctx, `INSERT INTO auth_sessions(id,user_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4,$5)`, uuid.NewString(), userID, tokenHash(token), tokenHash(csrf), s.now().Add(7*24*time.Hour))
	return token, csrf, e
}
func (s *Server) sendSession(w http.ResponseWriter, status int, u User, token, csrf string) {
	http.SetCookie(w, &http.Cookie{Name: "focus_session", Value: token, Path: "/", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: 7 * 24 * 60 * 60})
	writeJSON(w, status, map[string]any{"user": u, "csrfToken": csrf})
}
func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if !decode(w, r, &in) {
		return
	}
	email, ok := normalizedEmail(in.Email)
	if !ok || !validPassword(in.Password) {
		fail(w, 422, "validation", "Enter a valid email and a password of 12–128 characters")
		return
	}
	if s.limited(w, r, email) {
		return
	}
	if in.Timezone == "" {
		in.Timezone = "UTC"
	}
	if _, e := time.LoadLocation(in.Timezone); e != nil {
		fail(w, 422, "validation", "Choose a valid time zone")
		return
	}
	hash := hashPassword(in.Password)
	tx, e := s.pool.Begin(r.Context())
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	u := User{uuid.NewString(), email}
	_, e = tx.Exec(r.Context(), "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)", u.ID, u.Email, hash)
	if e != nil {
		var pe *pgconn.PgError
		if errors.As(e, &pe) && pe.Code == "23505" {
			fail(w, 409, "registration", "Unable to create this account. Try signing in.")
			return
		}
		internal(w, e)
		return
	}
	_, e = tx.Exec(r.Context(), "INSERT INTO settings(user_id,timezone) VALUES($1,$2)", u.ID, in.Timezone)
	if e != nil {
		internal(w, e)
		return
	}
	token, csrf, e := s.createSession(r.Context(), tx, u.ID)
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		internal(w, e)
		return
	}
	s.sendSession(w, 201, u, token, csrf)
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if !decode(w, r, &in) {
		return
	}
	email, _ := normalizedEmail(in.Email)
	if s.limited(w, r, email) {
		return
	}
	var u User
	var hash string
	e := s.pool.QueryRow(r.Context(), "SELECT id::text,email,password_hash FROM users WHERE email=$1", email).Scan(&u.ID, &u.Email, &hash)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		internal(w, e)
		return
	}
	if errors.Is(e, pgx.ErrNoRows) {
		hashPassword("timing-only-dummy-password")
		fail(w, 401, "credentials", "Email or password is incorrect")
		return
	}
	if !validPassword(in.Password) || !verifyPassword(hash, in.Password) {
		fail(w, 401, "credentials", "Email or password is incorrect")
		return
	}
	tx, e := s.pool.Begin(r.Context())
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	// Recheck under the same row lock used by password changes.
	var currentHash string
	e = tx.QueryRow(r.Context(), "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE", u.ID).Scan(&currentHash)
	if e != nil {
		internal(w, e)
		return
	}
	if currentHash != hash {
		fail(w, 401, "credentials", "Email or password is incorrect")
		return
	}
	token, csrf, e := s.createSession(r.Context(), tx, u.ID)
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		internal(w, e)
		return
	}
	s.sendSession(w, 200, u, token, csrf)
}
func (s *Server) authenticate(w http.ResponseWriter, r *http.Request) (Principal, bool) {
	var p Principal
	c, e := r.Cookie("focus_session")
	if e != nil || len(c.Value) != 64 {
		fail(w, 401, "unauthenticated", "Please sign in")
		return p, false
	}
	p.Token = c.Value
	e = s.pool.QueryRow(r.Context(), `SELECT u.id::text,u.email,a.id::text,a.csrf_hash FROM auth_sessions a JOIN users u ON u.id=a.user_id WHERE a.token_hash=$1 AND a.revoked_at IS NULL AND a.expires_at>$2`, tokenHash(c.Value), s.now()).Scan(&p.ID, &p.Email, &p.SessionID, &p.CSRFHash)
	if errors.Is(e, pgx.ErrNoRows) {
		fail(w, 401, "unauthenticated", "Please sign in")
		return p, false
	}
	if e != nil {
		internal(w, e)
		return p, false
	}
	if r.Method != "GET" && !equal(tokenHash(r.Header.Get("X-CSRF-Token")), p.CSRFHash) {
		fail(w, 403, "csrf", "Refresh the page and try again")
		return p, false
	}
	return p, true
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	p, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var zone, appearance string
	var focus, short, long int
	var sound bool
	var revision int64
	e := s.pool.QueryRow(r.Context(), "SELECT timezone,appearance,focus_minutes,short_break_minutes,long_break_minutes,sound,revision FROM settings WHERE user_id=$1", p.ID).Scan(&zone, &appearance, &focus, &short, &long, &sound, &revision)
	if e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"user": p.User, "csrfToken": tokenHash("csrf:" + p.Token), "settings": map[string]any{"timezone": zone, "appearance": appearance, "focusMinutes": focus, "shortBreakMinutes": short, "longBreakMinutes": long, "sound": sound, "revision": revision}})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	p, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	_, e := s.pool.Exec(r.Context(), "UPDATE auth_sessions SET revoked_at=$1 WHERE id=$2", s.now(), p.SessionID)
	if e != nil {
		internal(w, e)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "focus_session", Value: "", Path: "/", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (s *Server) password(w http.ResponseWriter, r *http.Request) {
	p, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var in struct {
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !validPassword(in.NewPassword) {
		fail(w, 422, "validation", "Use a password of 12–128 characters")
		return
	}
	if s.limited(w, r, p.Email) {
		return
	}
	tx, e := s.pool.Begin(r.Context())
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var hash string
	e = tx.QueryRow(r.Context(), "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE", p.ID).Scan(&hash)
	if e != nil {
		internal(w, e)
		return
	}
	if !verifyPassword(hash, in.OldPassword) {
		fail(w, 401, "credentials", "Current password is incorrect")
		return
	}
	// A password change must still own a valid session after acquiring the lock.
	var valid bool
	e = tx.QueryRow(r.Context(), "SELECT revoked_at IS NULL AND expires_at>$2 FROM auth_sessions WHERE id=$1", p.SessionID, s.now()).Scan(&valid)
	if e != nil {
		internal(w, e)
		return
	}
	if !valid {
		fail(w, 401, "unauthenticated", "Please sign in")
		return
	}
	_, e = tx.Exec(r.Context(), "UPDATE users SET password_hash=$1 WHERE id=$2", hashPassword(in.NewPassword), p.ID)
	if e == nil {
		_, e = tx.Exec(r.Context(), "UPDATE auth_sessions SET revoked_at=$1 WHERE user_id=$2 AND id<>$3", s.now(), p.ID, p.SessionID)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
