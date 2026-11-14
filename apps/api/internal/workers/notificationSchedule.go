package workers

import (
	"context"
	"errors"
	"time"

	"focuscalendar/internal/database"
	"focuscalendar/internal/services"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NotificationSchedule implements bounded DB operations for the coordinator.
// Each account lane owns its cursor and must run at most once concurrently,
// as guaranteed by Scheduler. Different lanes and Next can run independently.
type NotificationSchedule struct {
	Pool          *pgxpool.Pool
	Now           func() time.Time
	Notifications services.NotificationWorker
	focusTurn     accountTurn
	horizonTurn   accountTurn
}

const focusDueExpression = `running_since + (target_seconds::double precision - accumulated_us::double precision/1000000) * interval '1 second'`

func (s *NotificationSchedule) Next(ctx context.Context) (Deadlines, error) {
	var out Deadlines
	var focus, horizon, cleanup *time.Time
	err := s.Pool.QueryRow(ctx, `SELECT
 (SELECT min(`+focusDueExpression+`) FROM focus_sessions WHERE status='running'),
 (SELECT min(next_run_at) FROM notification_horizons),
 (SELECT next_run_at FROM notification_maintenance WHERE name='cleanup')`).Scan(&focus, &horizon, &cleanup)
	if err != nil {
		return out, err
	}
	for j, at := range map[Job]*time.Time{Focus: focus, Horizon: horizon, Cleanup: cleanup} {
		if at != nil {
			out[j] = *at
		}
	}
	out[Dispatch], err = s.Notifications.NextDue(ctx)
	return out, err
}

func (s *NotificationSchedule) Run(ctx context.Context, job Job) error {
	switch job {
	case Focus:
		return s.settleFocus(ctx)
	case Dispatch:
		_, err := s.Notifications.Run(ctx, 3)
		return err
	case Horizon:
		return s.extendHorizon(ctx)
	case Cleanup:
		return s.cleanup(ctx)
	default:
		return errors.New("unknown scheduler job")
	}
}

func (s *NotificationSchedule) settleFocus(ctx context.Context) error {
	return s.focusTurn.run(ctx, func(ctx context.Context, after string) (string, error) {
		var user string
		err := s.Pool.QueryRow(ctx, `SELECT user_id FROM focus_sessions WHERE status='running'
 AND `+focusDueExpression+` <= $1
 AND ($2::uuid IS NULL OR user_id > $2::uuid) ORDER BY user_id LIMIT 1`, s.Now(), accountCursor(after)).Scan(&user)
		return user, err
	}, func(ctx context.Context, user string) error {
		// The account lock serializes with pause/resume/edit. Revalidate in SettleFocus.
		// Do not run historical planning/recurrence settlement on this urgent lane.
		return database.WithTx(ctx, s.Pool, user, func(tx pgx.Tx, _ string) error {
			return services.SettleFocus(ctx, tx, user, s.Now())
		})
	})
}

func (s *NotificationSchedule) extendHorizon(ctx context.Context) error {
	return s.horizonTurn.run(ctx, func(ctx context.Context, after string) (string, error) {
		var user string
		err := s.Pool.QueryRow(ctx, `SELECT user_id FROM notification_horizons WHERE next_run_at <= $1
 AND ($2::uuid IS NULL OR user_id > $2::uuid) ORDER BY user_id LIMIT 1`, s.Now(), accountCursor(after)).Scan(&user)
		return user, err
	}, func(ctx context.Context, user string) error {
		// Lock settings BEFORE the queue row: mutations take the same order and their
		// invalidation trigger cannot be overwritten by a concurrent materialization.
		return database.WithTx(ctx, s.Pool, user, func(tx pgx.Tx, zone string) error {
			var due time.Time
			if err := tx.QueryRow(ctx, "SELECT next_run_at FROM notification_horizons WHERE user_id=$1 FOR UPDATE", user).Scan(&due); err != nil {
				return err
			}
			now := s.Now()
			if due.After(now) {
				return nil
			}
			if err := services.MaterializeReminderHorizon(ctx, tx, user, zone, now); err != nil {
				return err
			}
			loc, err := time.LoadLocation(zone)
			if err != nil {
				return err
			}
			local := now.In(loc)
			next := time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 0, 0, loc)
			_, err = tx.Exec(ctx, "UPDATE notification_horizons SET next_run_at=$2 WHERE user_id=$1", user, next)
			return err
		})
	})
}

func accountCursor(after string) any {
	if after == "" {
		return nil
	}
	return after
}

func (s *NotificationSchedule) cleanup(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	var due time.Time
	err = tx.QueryRow(ctx, "SELECT next_run_at FROM notification_maintenance WHERE name='cleanup' FOR UPDATE").Scan(&due)
	if err != nil {
		return err
	}
	now := s.Now()
	if due.After(now) {
		return nil
	}
	result, err := tx.Exec(ctx, `WITH expired AS (
 SELECT id FROM notification_outbox WHERE finished_at IS NOT NULL
 AND finished_at < $1::timestamptz-interval '30 days'
 ORDER BY finished_at,id LIMIT 500 FOR UPDATE SKIP LOCKED
 ) DELETE FROM notification_outbox o USING expired e WHERE o.id=e.id`, now)
	if err != nil {
		return err
	}
	next := now.Add(24 * time.Hour)
	if result.RowsAffected() == 500 {
		next = now.Add(time.Second)
	}
	if _, err = tx.Exec(ctx, "UPDATE notification_maintenance SET next_run_at=$1 WHERE name='cleanup'", next); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
