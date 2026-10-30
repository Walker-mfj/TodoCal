package repository

import (
	"context"
	"time"

	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5/pgconn"
)

func IncrementAuthAttempts(ctx context.Context, db DBTX, key string, now time.Time, resultCount *int) error {
	return db.QueryRow(ctx, `INSERT INTO auth_attempts(key,attempts,window_start) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_attempts.window_start < $2::timestamptz-interval '15 minutes' THEN 1 ELSE auth_attempts.attempts+1 END, window_start=CASE WHEN auth_attempts.window_start < $2::timestamptz-interval '15 minutes' THEN $2 ELSE auth_attempts.window_start END RETURNING attempts`, key, now).Scan(resultCount)
}

func InsertSession(ctx context.Context, db DBTX, sessionID string, userID string, tokenHash string, csrfHash string, expiresAt time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO auth_sessions(id,user_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4,$5)`, sessionID, userID, tokenHash, csrfHash, expiresAt)
}

func InsertAccount(ctx context.Context, db DBTX, userID string, email string, hash string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)", userID, email, hash)
}

func InsertDefaultSettings(ctx context.Context, db DBTX, userID string, zone string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, "INSERT INTO settings(user_id,timezone) VALUES($1,$2)", userID, zone)
}

func ReadAccountCredentials(ctx context.Context, db DBTX, email string, resultID *string, resultEmail *string, resultHash *string) error {
	return db.QueryRow(ctx, "SELECT id::text,email,password_hash FROM users WHERE email=$1", email).Scan(resultID, resultEmail, resultHash)
}

func LockPasswordHash(ctx context.Context, db DBTX, userID string, resultCurrentHash *string) error {
	return db.QueryRow(ctx, "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE", userID).Scan(resultCurrentHash)
}

func LockAccountPassword(ctx context.Context, db DBTX, userID string, resultHash *string) error {
	return db.QueryRow(ctx, "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE", userID).Scan(resultHash)
}

func ValidateSession(ctx context.Context, db DBTX, sessionID string, now time.Time, resultValid *bool) error {
	return db.QueryRow(ctx, "SELECT revoked_at IS NULL AND expires_at>$2 FROM auth_sessions WHERE id=$1", sessionID, now).Scan(resultValid)
}

func UpdatePasswordHash(ctx context.Context, db DBTX, hash string, userID string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, "UPDATE users SET password_hash=$1 WHERE id=$2", hash, userID)
}

func RevokeOtherSessions(ctx context.Context, db DBTX, now time.Time, userID string, sessionID string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, "UPDATE auth_sessions SET revoked_at=$1 WHERE user_id=$2 AND id<>$3", now, userID, sessionID)
}

func ReadSessionPrincipal(ctx context.Context, db DBTX, tokenHash string, now time.Time, out *models.Principal) error {
	return db.QueryRow(ctx, `SELECT u.id::text,u.email,a.id::text,a.csrf_hash FROM auth_sessions a JOIN users u ON u.id=a.user_id WHERE a.token_hash=$1 AND a.revoked_at IS NULL AND a.expires_at>$2`, tokenHash, now).Scan(&out.ID, &out.Email, &out.SessionID, &out.CSRFHash)
}

func ReadAccountSettings(ctx context.Context, db DBTX, userID string, resultZone *string, resultAppearance *string, resultFocus *int, resultShort *int, resultLong *int, resultSound *bool, resultRevision *int64) error {
	return db.QueryRow(ctx, "SELECT timezone,appearance,focus_minutes,short_break_minutes,long_break_minutes,sound,revision FROM settings WHERE user_id=$1", userID).Scan(resultZone, resultAppearance, resultFocus, resultShort, resultLong, resultSound, resultRevision)
}

func RevokeSession(ctx context.Context, db DBTX, now time.Time, sessionID string, userID string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, "UPDATE auth_sessions SET revoked_at=$1 WHERE id=$2 AND user_id=$3", now, sessionID, userID)
}
