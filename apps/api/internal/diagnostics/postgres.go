package diagnostics

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PGTracer struct{}
type dbKey string
type dbCall struct {
	start       time.Time
	contextDone bool
}

func beginDB(ctx context.Context, key dbKey) context.Context {
	if !Active(ctx) {
		return ctx
	}
	return context.WithValue(ctx, key, dbCall{time.Now(), ctx.Err() != nil})
}
func endDB(ctx context.Context, key dbKey, err error) {
	s := from(ctx)
	if s == nil {
		return
	}
	call, ok := ctx.Value(key).(dbCall)
	if !ok {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if key == "pool_acquire" {
		s.acquire += time.Since(call.start)
		s.acquires++
	} else {
		s.query += time.Since(call.start)
		s.queries++
	}
	s.contextDone = s.contextDone || call.contextDone
	// No rows is commonly an expected domain outcome, not a failed DB operation.
	if err != nil && !errors.Is(err, pgx.ErrNoRows) && s.category == "" {
		s.stage = string(key)
		s.category = Category(err, s.stage)
	}
}
func (PGTracer) TraceAcquireStart(ctx context.Context, _ *pgxpool.Pool, _ pgxpool.TraceAcquireStartData) context.Context {
	return beginDB(ctx, "pool_acquire")
}
func (PGTracer) TraceAcquireEnd(ctx context.Context, _ *pgxpool.Pool, data pgxpool.TraceAcquireEndData) {
	endDB(ctx, "pool_acquire", data.Err)
}
func (PGTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	return beginDB(ctx, "query")
}
func (PGTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	endDB(ctx, "query", data.Err)
}

// LogPool uses interval deltas, never cumulative counters mislabeled as request
// timings. The caller cancels ctx before closing pool.
func LogPool(ctx context.Context, pool *pgxpool.Pool, logger *slog.Logger, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	prev := pool.Stat()
	since := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			stat := pool.Stat()
			logger.InfoContext(ctx, "database pool", "event", "db_pool_summary", "interval_ms", now.Sub(since).Milliseconds(), "acquired_conns", stat.AcquiredConns(), "idle_conns", stat.IdleConns(), "total_conns", stat.TotalConns(), "max_conns", stat.MaxConns(), "empty_acquire_delta", stat.EmptyAcquireCount()-prev.EmptyAcquireCount(), "canceled_acquire_delta", stat.CanceledAcquireCount()-prev.CanceledAcquireCount(), "acquire_duration_delta_ms", (stat.AcquireDuration() - prev.AcquireDuration()).Milliseconds())
			prev = stat
			since = now
		}
	}
}
