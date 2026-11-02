package workers

import (
	"context"
	"errors"
	"time"

	"focuscalendar/internal/repository"
	"focuscalendar/internal/services"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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
		ids, e := repository.ListAccountIDs(ctx, pool, w.Cursor)
		if e != nil {
			return count, errors.Join(append(failures, e)...)
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
			e = services.WithTx(accountCtx, pool, id, now, func(tx pgx.Tx, zone string, stamp time.Time) error {
				if err := services.SettleFocus(accountCtx, tx, id, stamp); err != nil {
					return err
				}
				return services.MaterializeReminderHorizon(accountCtx, tx, id, zone, stamp)
			})
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
