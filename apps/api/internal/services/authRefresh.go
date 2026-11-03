package services

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"time"
)

// Refresh rotates credentials while retaining the family identity used for
// revocation. Consumed hashes remain available to detect replay of any ancestor.
func (s *Auth) Refresh(ctx context.Context, token string) (SessionResult, error) {
	denied := &Fault{Code: "unauthenticated", Message: "Please sign in"}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return SessionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var out SessionResult
	var id string
	var expires time.Time
	var revoked, consumed *time.Time
	// Lock the family before the token. Concurrent refreshes serialize here.
	err = tx.QueryRow(ctx, `SELECT a.id::text,u.id::text,u.email,a.refresh_expires_at,a.revoked_at,COALESCE(a.browser_id::text,'')
 FROM auth_sessions a JOIN auth_refresh_tokens t ON t.session_id=a.id JOIN users u ON u.id=a.user_id
 WHERE t.token_hash=$1 FOR UPDATE OF a`, tokenHash(token)).Scan(&id, &out.User.ID, &out.User.Email, &expires, &revoked, &out.BrowserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SessionResult{}, denied
	}
	if err != nil {
		return SessionResult{}, err
	}
	now := s.Now()
	if revoked != nil || !expires.After(now) {
		return SessionResult{}, denied
	}
	err = tx.QueryRow(ctx, "SELECT consumed_at FROM auth_refresh_tokens WHERE token_hash=$1", tokenHash(token)).Scan(&consumed)
	if err != nil {
		return SessionResult{}, err
	}
	// Brief bounded grace supports parallel tabs and retry after a lost response.
	// Never extend the grace of a consumed token.
	if consumed != nil && !consumed.Add(30*time.Second).After(now) {
		_, err = tx.Exec(ctx, "UPDATE auth_sessions SET revoked_at=$2 WHERE id=$1", id, now)
		if err == nil {
			err = tx.Commit(ctx)
		}
		if err != nil {
			return SessionResult{}, err
		}
		return SessionResult{}, denied
	}
	out.Token = randomToken(32)
	out.CSRF = tokenHash("csrf:" + out.Token)
	out.Refresh = randomToken(32)
	_, err = tx.Exec(ctx, "UPDATE auth_refresh_tokens SET consumed_at=$2 WHERE session_id=$1 AND consumed_at IS NULL", id, now)
	if err == nil {
		_, err = tx.Exec(ctx, "INSERT INTO auth_refresh_tokens(token_hash,session_id) VALUES($1,$2)", tokenHash(out.Refresh), id)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE auth_sessions SET token_hash=$2,csrf_hash=$3,expires_at=$4,refresh_expires_at=$5 WHERE id=$1`, id, tokenHash(out.Token), tokenHash(out.CSRF), now.Add(time.Hour), now.Add(30*24*time.Hour))
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	return out, err
}
