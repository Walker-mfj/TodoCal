package repository

import (
	"context"

	"github.com/jackc/pgx/v5"
)

func ListAccountIDs(ctx context.Context, db DBTX, cursor string) ([]string, error) {
	rows, err := db.Query(ctx, `SELECT id::text FROM users WHERE id>$1 ORDER BY id LIMIT 100`, cursor)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (string, error) { return scanString(row) })
}
