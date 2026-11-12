package diagnostics

import (
	"context"
	"log/slog"
	"time"
)

// JobFailure emits one bounded record per failed scheduled operation, without
// retaining the error text. Successful operations and disabled diagnostics are silent.
func JobFailure(ctx context.Context, logger *slog.Logger, operation string, started time.Time, err error) {
	if err == nil || !Active(ctx) {
		return
	}
	stage := "unknown"
	switch operation {
	case "focus.sweep", "notifications.run":
	case "jobs.query":
		stage = "query"
	default:
		return
	}
	fields := SafeContext(ctx)
	fields["operation"] = operation
	// Do not attach the previous operation's database stage.
	fields["db_stage"] = stage
	fields["error_category"] = Category(err, stage)
	attrs := []any{"event", "scheduled_operation_failed", "duration_ms", float64(time.Since(started).Microseconds()) / 1000}
	for k, v := range FilterContext(fields) {
		attrs = append(attrs, k, v)
	}
	logger.ErrorContext(ctx, "scheduled operation failed", attrs...)
}
