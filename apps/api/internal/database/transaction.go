// Package database owns connections, migrations and serialized account transactions.
package database

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WithTx locks the settings row. All domain mutations and the future history
// worker must use this same lock; helpers receive tx and must not nest WithTx.
func WithTx(ctx context.Context, pool *pgxpool.Pool, userID string, fn func(pgx.Tx, string) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	var zone string
	if err = tx.QueryRow(ctx, `SELECT timezone FROM settings WHERE user_id=$1 FOR UPDATE`, userID).Scan(&zone); err != nil {
		return err
	}
	if err = fn(tx, zone); err != nil {
		return err
	}
	return Commit(ctx, tx)
}
