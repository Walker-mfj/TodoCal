package database

import (
	"context"
	"github.com/jackc/pgx/v5"
)

type scheduleWakeKey struct{}

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
// Even read endpoints can settle Focus or materialize tasks inside WithTx.
func Commit(ctx context.Context, tx pgx.Tx) error {
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	PublishScheduleWake(ctx)
	return nil
}
