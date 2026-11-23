package services

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"focuscalendar/internal/database"
	"focuscalendar/internal/localdate"
	"focuscalendar/internal/repository"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Settle performs at most 31 calendar days per transaction. False means the
// caller must commit this batch and repeat before allowing the user's command.
func Settle(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time) (bool, error) {
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return false, e
	}
	today := now.In(loc).Format("2006-01-02")
	var through *string
	e = repository.ReadPlanningCursor(ctx, tx, user, &through)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return false, e
	}
	var next *string
	if through != nil {
		v := localdate.Add(*through, 1)
		next = &v
	}
	var first *string
	e = repository.FindFirstUnsettledDate(ctx, tx, user, today, next, &first)
	if e != nil {
		return false, e
	}
	end := today
	if first != nil {
		if limit := localdate.Add(*first, 31); limit < end {
			end = limit
		}
		if e = Materialize(ctx, tx, user, zone, *first, end, now); e != nil {
			return false, e
		}
		for date := *first; date < end; date = localdate.Add(date, 1) {
			if e = Finalize(ctx, tx, user, zone, date, now); e != nil {
				return false, e
			}
		}
	}
	_, e = repository.AdvancePlanningCursor(ctx, tx, user, localdate.Add(end, -1))
	if e != nil {
		return false, e
	}
	if end < today {
		return false, nil
	}
	if e = Materialize(ctx, tx, user, zone, today, localdate.Add(today, 1), now); e != nil {
		return false, e
	}
	return true, settleReopenedDays(ctx, tx, user, zone, today, now)
}

func WithTx(ctx context.Context, pool *pgxpool.Pool, user string, now func() time.Time, fn func(pgx.Tx, string, time.Time) error) error {
	for {
		if e := ctx.Err(); e != nil {
			return e
		}
		done := false
		e := database.WithTx(ctx, pool, user, func(tx pgx.Tx, zone string) error {
			stamp := now().UTC()
			var err error
			done, err = Settle(ctx, tx, user, zone, stamp)
			if err != nil {
				return err
			}
			if !done {
				return nil
			}
			return fn(tx, zone, stamp)
		})
		if e != nil {
			return e
		}
		if done {
			return nil
		}
	}
}

// BeforeZoneChange seals dates crossed by a forward time-zone jump using the
// states already accepted under the old zone. Ordinary next-midnight cutoff
// would otherwise erase tasks created after that retroactive boundary.
func BeforeZoneChange(ctx context.Context, tx pgx.Tx, user, oldZone, newZone string, now time.Time) error {
	oldLoc, e := time.LoadLocation(oldZone)
	if e != nil {
		return e
	}
	newLoc, e := time.LoadLocation(newZone)
	if e != nil {
		return e
	}
	from, to := now.In(oldLoc).Format("2006-01-02"), now.In(newLoc).Format("2006-01-02")

	if from >= to {
		return nil
	}
	if e = Materialize(ctx, tx, user, oldZone, from, to, now); e != nil {
		return e
	}
	for date := from; date < to; date = localdate.Add(date, 1) {
		if e = finalizeAt(ctx, tx, user, oldZone, date, now, now.Add(time.Microsecond)); e != nil {
			return e
		}
	}
	return nil
}

// Preserve every accepted entry and append only previously unattributed tasks
// when a reopened date ends in the current account zone.
func settleReopenedDays(ctx context.Context, tx pgx.Tx, user, zone, today string, now time.Time) error {
	rows, err := tx.Query(ctx, `SELECT DISTINCT task_local_date(t)::text FROM tasks t JOIN daily_snapshots s ON s.user_id=t.user_id AND s.date=task_local_date(t) WHERE t.user_id=$1 AND t.deleted_at IS NULL AND task_local_date(t)<$2::date AND NOT EXISTS(SELECT 1 FROM daily_plan_entries p WHERE p.user_id=t.user_id AND p.task_id=t.id)`, user, today)
	if err != nil {
		return err
	}
	var dates []string
	for rows.Next() {
		var date string
		if err = rows.Scan(&date); err != nil {
			rows.Close()
			return err
		}
		dates = append(dates, date)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return err
	}
	for _, date := range dates {
		entries, err := endedEntries(ctx, tx, user, zone, date, localdate.Boundary(localdate.Add(date, 1), loc))
		if err != nil {
			return err
		}
		for _, entry := range entries {
			entry.Timezone = zone
			raw, err := json.Marshal(entry)
			if err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, `INSERT INTO daily_plan_entries(user_id,date,task_id,task_state) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, user, date, entry.Task.ID, raw); err != nil {
				return err
			}
		}
		if _, err = repository.RecountSnapshot(ctx, tx, user, date); err != nil {
			return err
		}
	}
	return nil
}
