// Package diagnostics records bounded technical metadata only. It does not
// retain error messages, SQL, parameters, URLs, headers or user identities.
package diagnostics

import (
	"context"
	"regexp"
	"sync"
	"time"
)

type requestKey struct{}
type state struct {
	mu                                    sync.Mutex
	id, route, operation, category, stage string
	acquire, query                        time.Duration
	queries, acquires                     int
	contextDone                           bool
}

func from(ctx context.Context) *state { s, _ := ctx.Value(requestKey{}).(*state); return s }
func WithRequest(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestKey{}, &state{id: id, route: "unknown", operation: "api.request", stage: "unknown"})
}
func Active(ctx context.Context) bool { return from(ctx) != nil }
func RequestID(ctx context.Context) string {
	if s := from(ctx); s != nil {
		return s.id
	}
	return ""
}

// SetRoute accepts only compile-time router patterns, never a raw URL path.
func SetRoute(ctx context.Context, pattern string) {
	if s := from(ctx); s != nil {
		s.mu.Lock()
		defer s.mu.Unlock()
		if _, ok := routes[pattern]; ok {
			s.route = pattern
			s.operation = operation(pattern)
		}
	}
}
func operation(route string) string {
	switch route {
	case "GET /api/v1/calendar":
		return "calendar.view"
	case "GET /api/v1/reports/days/{date}":
		return "day_details.view"
	case "GET /api/v1/reports/period":
		return "period_report.view"
	case "GET /api/v1/tasks":
		return "tasks.list"
	case "GET /api/v1/auth/me":
		return "auth.me"
	default:
		return "api.request"
	}
}
func RecordError(ctx context.Context, err error) {
	if s := from(ctx); s != nil {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.category == "" {
			s.category = Category(err, s.stage)
		}
	}
}
func SafeContext(ctx context.Context) map[string]string {
	s := from(ctx)
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return map[string]string{"request_id": s.id, "route": s.route, "operation": s.operation, "error_category": s.category, "db_stage": s.stage}
}

var requestIDPattern = regexp.MustCompile(`^[a-f0-9]{24}$`)

// FilterContext is also applied at the reporter boundary. Browser events cannot
// supply these server-side fields. Unknown keys and values are discarded.
func FilterContext(in map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range in {
		switch k {
		case "request_id":
			if requestIDPattern.MatchString(v) {
				out[k] = v
			}
		case "route":
			if _, ok := routes[v]; ok || v == "unknown" {
				out[k] = v
			}
		case "operation":
			switch v {
			case "calendar.view", "day_details.view", "period_report.view", "tasks.list", "auth.me", "api.request":
				out[k] = v
			}
		case "error_category":
			switch v {
			case "request_cancelled", "deadline_exceeded", "db_pool_acquire_timeout", "database_timeout", "database_unavailable", "database_constraint", "internal", "panic":
				out[k] = v
			}
		case "db_stage":
			switch v {
			case "pool_acquire", "query", "unknown":
				out[k] = v
			}
		}
	}
	return out
}

func RecordPanic(ctx context.Context) {
	if s := from(ctx); s != nil {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.category = "panic"
	}
}
