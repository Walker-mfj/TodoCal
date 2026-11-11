package diagnostics

import (
	"crypto/rand"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/felixge/httpsnoop"
)

// HTTP must be the outermost application handler, including proxy and security
// checks. No incoming request identifier is trusted.
func HTTP(next http.Handler, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var token [12]byte
		if _, err := rand.Read(token[:]); err != nil {
			panic("secure random unavailable")
		}
		id := hex.EncodeToString(token[:])
		w.Header().Set("X-Request-ID", id)
		r = r.WithContext(WithRequest(r.Context(), id))
		started := time.Now()
		code := 0
		complete := false
		finalStatus := func(status int) {
			if code == 0 && (status == 101 || status >= 200) {
				code = status
			}
		}
		ww := httpsnoop.Wrap(w, httpsnoop.Hooks{
			ReadFrom: func(next httpsnoop.ReadFromFunc) httpsnoop.ReadFromFunc {
				return func(src io.Reader) (int64, error) { finalStatus(200); return next(src) }
			},
			FlushError: func(next httpsnoop.FlushErrorFunc) httpsnoop.FlushErrorFunc {
				return func() error { finalStatus(200); return next() }
			},
			WriteHeader: func(next httpsnoop.WriteHeaderFunc) httpsnoop.WriteHeaderFunc {
				return func(status int) { finalStatus(status); next(status) }
			},
			Write: func(next httpsnoop.WriteFunc) httpsnoop.WriteFunc {
				return func(p []byte) (int, error) { finalStatus(200); return next(p) }
			},
			Flush: func(next httpsnoop.FlushFunc) httpsnoop.FlushFunc { return func() { finalStatus(200); next() } },
		})
		defer func() {
			s := from(r.Context())
			s.mu.Lock()
			defer s.mu.Unlock()
			if complete && code == 0 {
				code = 200
			}
			// Healthy probes and ingest/job loops do not produce completion noise.
			if complete && code < 400 && (s.route == "GET /healthz" || s.route == "GET /readyz" || s.route == "POST /internal/jobs" || s.route == "POST /api/v1/monitoring/errors") {
				return
			}
			method := r.Method
			switch method {
			case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS":
			default:
				method = "unknown"
			}
			level := slog.LevelInfo
			if code >= 500 || !complete {
				level = slog.LevelError
			}
			attrs := []any{"event", "http_request_completed", "request_id", id, "method", method, "route", s.route, "status_code", code, "duration_ms", float64(time.Since(started).Microseconds()) / 1000, "response_complete", complete}
			if s.category != "" {
				attrs = append(attrs, "error_category", s.category, "operation", s.operation, "db_stage", s.stage)
			}
			if s.acquires+s.queries > 0 {
				attrs = append(attrs, "db_acquire_ms", float64(s.acquire.Microseconds())/1000, "db_query_ms", float64(s.query.Microseconds())/1000, "db_acquire_count", s.acquires, "db_query_count", s.queries, "db_context_already_done", s.contextDone)
			}
			logger.Log(r.Context(), level, "http request completed", attrs...)
		}()
		next.ServeHTTP(ww, r)
		complete = true
	})
}
