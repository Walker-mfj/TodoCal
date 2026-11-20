package database

import (
	"context"
	"github.com/jackc/pgx/v5"
)

type scheduleWakeKey struct{}
type scheduleBroadcastKey struct{}

// WithScheduleBroadcast enables a commit-coupled PostgreSQL notification.
func WithScheduleBroadcast(ctx context.Context) context.Context {
	return context.WithValue(ctx, scheduleBroadcastKey{}, true)
}

// WithScheduleWake attaches the process-local publisher at the application
// boundary. Background scheduler transactions omit it and report completion
// instead, avoiding a self-sustaining wake loop.
func WithScheduleWake(ctx context.Context, wake func()) context.Context {
	return context.WithValue(ctx, scheduleWakeKey{}, wake)
}

func PublishScheduleWake(ctx context.Context) {
	if wake, ok := ctx.Value(scheduleWakeKey{}).(func()); ok && wake != nil {
		wake()
	}
}

// Commit is the shared post-commit boundary for domain and auth transactions.
// Database row triggers mark only actual schedule changes, including lazy GET writes.
func Commit(ctx context.Context, tx pgx.Tx) error {
	dirty := false
	if wake, ok := ctx.Value(scheduleWakeKey{}).(func()); ok && wake != nil {
		if err := tx.QueryRow(ctx, "SELECT COALESCE(current_setting('todocal.schedule_dirty', true), '') = 'on'").Scan(&dirty); err != nil {
			return err
		}
	}
	if dirty && ctx.Value(scheduleBroadcastKey{}) == true {
		// NOTIFY is delivered only if the same transaction commits. The
		// leader also wakes after re-LISTEN to cover a disconnected listener.
		if _, err := tx.Exec(ctx, "SELECT pg_notify('todocal_schedule_wake', '')"); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if dirty {
		PublishScheduleWake(ctx)
	}
	return nil
}
