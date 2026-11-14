package services

import (
	"context"
	"errors"
	"focuscalendar/internal/database"
	"net/mail"
	"strings"
	"time"

	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type User = models.User
type Credentials struct{ Email, Password, Timezone, BrowserID string }
type PasswordInput struct{ OldPassword, NewPassword string }
type Auth struct {
	Pool *pgxpool.Pool
	Now  func() time.Time
}
type SessionResult struct {
	User                            User
	Token, CSRF, Refresh, BrowserID string
}

func normalizedEmail(v string) (string, bool) {
	v = strings.ToLower(strings.TrimSpace(v))
	a, e := mail.ParseAddress(v)
	return v, e == nil && a.Address == v && len(v) <= 254
}
func (s *Auth) Limited(ctx context.Context, email, ip string) (bool, error) {
	// Do not trust X-Forwarded-For from arbitrary clients.
	for _, key := range []string{"email:" + tokenHash(email), "ip:" + tokenHash(ip)} {
		limit := 10
		if strings.HasPrefix(key, "ip:") {
			limit = 60
		}
		var count int
		e := repository.IncrementAuthAttempts(ctx, s.Pool, key, s.Now(), &count)
		if e != nil {
			return true, e
		}
		if count > limit {
			return true, nil
		}
	}
	return false, nil
}
func (s *Auth) createSession(ctx context.Context, tx pgx.Tx, userID, browserID string) (string, string, string, error) {
	// Serialize successful logins for a browser, including different accounts.
	// This identity is not authentication; only a verified login reaches here.
	if browserID != "" {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", browserID); err != nil {
			return "", "", "", err
		}
	}
	token := randomToken(32)
	csrf := tokenHash("csrf:" + token)
	id := uuid.NewString()
	refresh := randomToken(32)
	_, e := repository.InsertSession(ctx, tx, id, userID, tokenHash(token), tokenHash(csrf), s.Now().Add(time.Hour))
	if e == nil {
		_, e = tx.Exec(ctx, "UPDATE auth_sessions SET refresh_expires_at=$2,browser_id=NULLIF($3,'')::uuid WHERE id=$1", id, s.Now().Add(30*24*time.Hour), browserID)
	}
	if e == nil {
		_, e = tx.Exec(ctx, "INSERT INTO auth_refresh_tokens(token_hash,session_id) VALUES($1,$2)", tokenHash(refresh), id)
	}
	if e == nil && browserID != "" {
		// Account switching ends the previous account's consent on this browser,
		// even when its credentials already expired. Other browsers are untouched.
		_, e = tx.Exec(ctx, `UPDATE push_subscriptions p SET revoked_at=$3 FROM auth_sessions a WHERE p.session_id=a.id AND a.browser_id=$1::uuid AND p.user_id<>$2 AND p.revoked_at IS NULL`, browserID, userID, s.Now())
	}
	if e == nil && browserID != "" {
		// Existing consent follows this browser across reauthentication, but an
		// explicit logout/revocation must never be undone by login.
		_, e = tx.Exec(ctx, `UPDATE push_subscriptions p SET session_id=$1 FROM auth_sessions a WHERE p.session_id=a.id AND p.user_id=$2 AND a.browser_id=$3::uuid AND a.revoked_at IS NULL AND p.revoked_at IS NULL`, id, userID, browserID)
	}
	return token, csrf, refresh, e
}
func (s *Auth) Register(ctx context.Context, in Credentials, ip string) (SessionResult, error) {
	email, ok := normalizedEmail(in.Email)
	if !ok || !validPassword(in.Password) {
		return SessionResult{}, &Fault{Code: "validation", Message: "Enter a valid email and a password of 12–128 characters"}
	}
	if limited, e := s.Limited(ctx, email, ip); e != nil {
		return SessionResult{}, e
	} else if limited {
		return SessionResult{}, &Fault{Code: "rate_limit", Message: "Too many attempts. Please try again later."}
	}
	if in.Timezone == "" {
		in.Timezone = "UTC"
	}
	if _, e := time.LoadLocation(in.Timezone); e != nil {
		return SessionResult{}, &Fault{Code: "validation", Message: "Choose a valid time zone"}
	}
	hash := hashPassword(in.Password)
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return SessionResult{}, e
	}
	defer func() { _ = tx.Rollback(ctx) }()
	u := User{ID: uuid.NewString(), Email: email}
	_, e = repository.InsertAccount(ctx, tx, u.ID, u.Email, hash)
	if e != nil {
		var pe *pgconn.PgError
		if errors.As(e, &pe) && pe.Code == "23505" {
			return SessionResult{}, &Fault{Code: "registration", Message: "Unable to create this account. Try signing in."}
		}
		return SessionResult{}, e
	}
	_, e = repository.InsertDefaultSettings(ctx, tx, u.ID, in.Timezone)
	if e != nil {
		return SessionResult{}, e
	}
	token, csrf, refresh, e := s.createSession(ctx, tx, u.ID, in.BrowserID)
	if e == nil {
		e = database.Commit(ctx, tx)
	}
	if e != nil {
		return SessionResult{}, e
	}
	return SessionResult{User: u, Token: token, CSRF: csrf, Refresh: refresh, BrowserID: in.BrowserID}, nil
}
func (s *Auth) Login(ctx context.Context, in Credentials, ip string) (SessionResult, error) {
	email, _ := normalizedEmail(in.Email)
	if limited, e := s.Limited(ctx, email, ip); e != nil {
		return SessionResult{}, e
	} else if limited {
		return SessionResult{}, &Fault{Code: "rate_limit", Message: "Too many attempts. Please try again later."}
	}
	var u User
	var hash string
	e := repository.ReadAccountCredentials(ctx, s.Pool, email, &u.ID, &u.Email, &hash)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return SessionResult{}, e
	}
	if errors.Is(e, pgx.ErrNoRows) {
		hashPassword("timing-only-dummy-password")
		return SessionResult{}, &Fault{Code: "credentials", Message: "Email or password is incorrect"}
	}
	if !validPassword(in.Password) || !verifyPassword(hash, in.Password) {
		return SessionResult{}, &Fault{Code: "credentials", Message: "Email or password is incorrect"}
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return SessionResult{}, e
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Recheck under the same row lock used by password changes.
	var currentHash string
	e = repository.LockPasswordHash(ctx, tx, u.ID, &currentHash)
	if e != nil {
		return SessionResult{}, e
	}
	if currentHash != hash {
		return SessionResult{}, &Fault{Code: "credentials", Message: "Email or password is incorrect"}
	}
	token, csrf, refresh, e := s.createSession(ctx, tx, u.ID, in.BrowserID)
	if e == nil {
		e = database.Commit(ctx, tx)
	}
	if e != nil {
		return SessionResult{}, e
	}
	return SessionResult{User: u, Token: token, CSRF: csrf, Refresh: refresh, BrowserID: in.BrowserID}, nil
}
func (s *Auth) Password(ctx context.Context, p Principal, in PasswordInput, ip string) error {
	if !validPassword(in.NewPassword) {
		return &Fault{Code: "validation", Message: "Use a password of 12–128 characters"}
	}
	if limited, e := s.Limited(ctx, p.Email, ip); e != nil {
		return e
	} else if limited {
		return &Fault{Code: "rate_limit", Message: "Too many attempts. Please try again later."}
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var hash string
	e = repository.LockAccountPassword(ctx, tx, p.ID, &hash)
	if e != nil {
		return e
	}
	if !verifyPassword(hash, in.OldPassword) {
		return &Fault{Code: "credentials", Message: "Current password is incorrect"}
	}
	// A password change must still own a valid session after acquiring the lock.
	var valid bool
	e = repository.ValidateSession(ctx, tx, p.SessionID, s.Now(), &valid)
	if e != nil {
		return e
	}
	if !valid {
		return &Fault{Code: "unauthenticated", Message: "Please sign in"}
	}
	_, e = repository.UpdatePasswordHash(ctx, tx, hashPassword(in.NewPassword), p.ID)
	if e == nil {
		_, e = repository.RevokeOtherSessions(ctx, tx, s.Now(), p.ID, p.SessionID)
	}
	if e == nil {
		e = database.Commit(ctx, tx)
	}
	if e != nil {
		return e
	}
	return nil
}
func (s *Auth) Authenticate(ctx context.Context, token string) (Principal, error) {
	p := Principal{Token: token}
	e := repository.ReadSessionPrincipal(ctx, s.Pool, tokenHash(token), s.Now(), &p)
	if errors.Is(e, pgx.ErrNoRows) {
		e = &Fault{Code: "unauthenticated", Message: "Please sign in"}
	}
	return p, e
}
func (s *Auth) Me(ctx context.Context, p Principal) (any, error) {
	var zone, appearance, timerSound string
	var focus, short, long, volume int
	var sound bool
	var revision int64
	e := repository.ReadAccountSettings(ctx, s.Pool, p.ID, &zone, &appearance, &focus, &short, &long, &sound, &timerSound, &volume, &revision)
	return map[string]any{"user": p.User, "csrfToken": tokenHash("csrf:" + p.Token), "settings": map[string]any{"timezone": zone, "appearance": appearance, "focusMinutes": focus, "shortBreakMinutes": short, "longBreakMinutes": long, "sound": sound, "timerSound": timerSound, "soundVolume": volume, "revision": revision}}, e
}
func (s *Auth) Logout(ctx context.Context, p Principal) error {
	_, e := repository.RevokeSession(ctx, s.Pool, s.Now(), p.SessionID, p.ID)
	if e == nil {
		database.PublishScheduleWake(ctx)
	}
	return e
}
