package planning

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

// Sweeper retains keyset progress across the periodic worker's bounded runs.
// Use one instance per worker goroutine; separate workers still share DB locks.
type Sweeper struct {
	Cursor         string
	AccountTimeout time.Duration
}

func (w *Sweeper) Sweep(ctx context.Context, pool *pgxpool.Pool, now func() time.Time) (int, error) {
	count := 0
	var failures []error
	if w.Cursor == "" {
		w.Cursor = "00000000-0000-0000-0000-000000000000"
	}
	timeout := w.AccountTimeout
	if timeout <= 0 {
		timeout = 2 * time.Second
	}
	for {
		if e := ctx.Err(); e != nil {
			return count, errors.Join(append(failures, e)...)
		}
		rows, e := pool.Query(ctx, `SELECT id::text FROM users WHERE id>$1 ORDER BY id LIMIT 100`, w.Cursor)
		if e != nil {
			return count, errors.Join(append(failures, e)...)
		}
		ids := []string{}
		for rows.Next() {
			var id string
			if e = rows.Scan(&id); e != nil {
				rows.Close()
				return count, e
			}
			ids = append(ids, id)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return count, e
		}
		if len(ids) == 0 {
			w.Cursor = ""
			return count, errors.Join(failures...)
		}
		for _, id := range ids {
			if e = ctx.Err(); e != nil {
				return count, errors.Join(append(failures, e)...)
			}
			// Advance even if this account times out; it gets another turn after wrap.
			w.Cursor = id
			accountCtx, cancel := context.WithTimeout(ctx, timeout)
			e = WithTx(accountCtx, pool, id, now, func(pgx.Tx, string, time.Time) error { return nil })
			cancel()
			if e != nil {
				failures = append(failures, e)
				continue
			}
			count++
		}
	}
}

// Sweep is the one-shot entrypoint used by tests and one-off callers.
func Sweep(ctx context.Context, pool *pgxpool.Pool, now func() time.Time) (int, error) {
	return (&Sweeper{}).Sweep(ctx, pool, now)
}
