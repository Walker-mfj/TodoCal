package services

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"focuscalendar/internal/database"
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
	var response []byte
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
	err = tx.QueryRow(ctx, "SELECT consumed_at,retry_response FROM auth_refresh_tokens WHERE token_hash=$1", tokenHash(token)).Scan(&consumed, &response)
	if err != nil {
		return SessionResult{}, err
	}
	// Brief bounded grace supports parallel tabs and retry after a lost response.
	// Never extend the grace of a consumed token.
	if consumed != nil && !consumed.Add(30*time.Second).After(now) {
		_, err = tx.Exec(ctx, "UPDATE auth_sessions SET revoked_at=$2 WHERE id=$1", id, now)
		if err == nil {
			err = database.Commit(ctx, tx)
		}
		if err != nil {
			return SessionResult{}, err
		}
		return SessionResult{}, denied
	}
	// A retry returns the original random credentials. The response is encrypted
	// with a key derived from the presented secret (not its stored hash).
	retry := func() (SessionResult, error) {
		if len(response) == 0 {
			return SessionResult{}, denied
		}
		if err := readRefreshResponse(token, id, response, &out); err != nil {
			return SessionResult{}, err
		}
		return out, database.Commit(ctx, tx)
	}
	if consumed != nil {
		return retry()
	}
	// Do not rotate the successor while its predecessor's responses may still
	// be in flight. This window is fixed by the original consumption time;
	// retries do not extend either the window or the idle expiry.
	var lastRotation *time.Time
	err = tx.QueryRow(ctx, "SELECT max(consumed_at) FROM auth_refresh_tokens WHERE session_id=$1", id).Scan(&lastRotation)
	if err != nil {
		return SessionResult{}, err
	}
	if lastRotation != nil && lastRotation.Add(30*time.Second).After(now) && len(response) > 0 {
		return retry()
	}
	out.Refresh = randomToken(32)
	out.Token = randomToken(32)
	out.CSRF = tokenHash("csrf:" + out.Token)
	previousResponse, err := sealRefreshResponse(token, id, out)
	if err != nil {
		return SessionResult{}, err
	}
	currentResponse, err := sealRefreshResponse(out.Refresh, id, out)
	if err != nil {
		return SessionResult{}, err
	}
	// Retain consumed hashes for replay detection, but discard old retry payloads.
	_, err = tx.Exec(ctx, "UPDATE auth_refresh_tokens SET retry_response=NULL WHERE session_id=$1 AND consumed_at<=$2", id, now.Add(-30*time.Second))
	if err == nil {
		_, err = tx.Exec(ctx, "UPDATE auth_refresh_tokens SET consumed_at=$2,retry_response=$3 WHERE token_hash=$1", tokenHash(token), now, previousResponse)
	}
	if err == nil {
		_, err = tx.Exec(ctx, "INSERT INTO auth_refresh_tokens(token_hash,session_id,retry_response) VALUES($1,$2,$3)", tokenHash(out.Refresh), id, currentResponse)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE auth_sessions SET token_hash=$2,csrf_hash=$3,expires_at=$4,refresh_expires_at=$5 WHERE id=$1`, id, tokenHash(out.Token), tokenHash(out.CSRF), now.Add(time.Hour), now.Add(30*24*time.Hour))
	}
	if err == nil {
		err = database.Commit(ctx, tx)
	}
	return out, err
}

// Domain separation is essential: tokenHash(token) is stored in the database
// and must never be usable as the encryption key. Successors remain random, so
// possession of an ancestor alone cannot predict future valid refresh tokens.
func refreshResponseCipher(token string) (cipher.AEAD, error) {
	key := sha256.Sum256([]byte("todocal:refresh-response:v1:" + token))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func sealRefreshResponse(token, family string, out SessionResult) ([]byte, error) {
	aead, err := refreshResponseCipher(token)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	body, err := json.Marshal([2]string{out.Token, out.Refresh})
	if err != nil {
		return nil, err
	}
	return aead.Seal(nonce, nonce, body, []byte(family)), nil
}
func readRefreshResponse(token, family string, response []byte, out *SessionResult) error {
	aead, err := refreshResponseCipher(token)
	if err != nil {
		return err
	}
	if len(response) < aead.NonceSize() {
		return errors.New("invalid refresh retry response")
	}
	body, err := aead.Open(nil, response[:aead.NonceSize()], response[aead.NonceSize():], []byte(family))
	if err != nil {
		return err
	}
	var credentials [2]string
	if err = json.Unmarshal(body, &credentials); err != nil {
		return err
	}
	out.Token, out.Refresh = credentials[0], credentials[1]
	out.CSRF = tokenHash("csrf:" + out.Token)
	return nil
}
