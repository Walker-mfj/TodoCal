package repository

import (
	"context"
	"time"

	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5/pgconn"
)

func ValidateOwnedSession(ctx context.Context, db DBTX, sessionID string, now time.Time, userID string, resultValid *bool) error {
	return db.QueryRow(ctx, `SELECT revoked_at IS NULL AND expires_at>$2 FROM auth_sessions WHERE id=$1 AND user_id=$3`, sessionID, now, userID).Scan(resultValid)
}

func ReadReceipt(ctx context.Context, db DBTX, userID string, key string) (hash string, outcome models.Outcome, body []byte, err error) {
	var status int
	err = db.QueryRow(ctx, `SELECT request_hash,response_status,response_body FROM mutation_receipts WHERE user_id=$1 AND idempotency_key=$2`, userID, key).Scan(&hash, &status, &body)
	if status == 201 {
		outcome = models.Created
	}
	return
}

func InsertReceipt(ctx context.Context, db DBTX, userID string, key string, hash string, outcome models.Outcome, body []byte, now time.Time) (pgconn.CommandTag, error) {
	status := 200
	if outcome == models.Created {
		status = 201
	}
	return db.Exec(ctx, `INSERT INTO mutation_receipts(user_id,idempotency_key,request_hash,response_status,response_body,created_at) VALUES($1,$2,$3,$4,$5,$6)`, userID, key, hash, status, body, now)
}
