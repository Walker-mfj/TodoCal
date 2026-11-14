package controllers

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"focuscalendar/internal/database"
	"focuscalendar/internal/middleware"
	"focuscalendar/internal/monitoring"
	"focuscalendar/internal/router"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	jobsSecret   string
	runJobs      func(context.Context) (any, error)
	jobsMu       sync.Mutex
	monitor      *monitoring.Reporter
	ingestLimit  ingestLimiter
	pool         *pgxpool.Pool
	origin       string
	secure       bool
	now          func() time.Time
	scheduleWake func()
}

func New(p *pgxpool.Pool, origin string, secure bool) *Server {
	return &Server{pool: p, origin: strings.TrimRight(origin, "/"), secure: secure, now: time.Now}
}
func (s *Server) Handler() http.Handler {
	handler := middleware.Security(s.observe(router.New(s)), s.origin)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.scheduleWake != nil {
			r = r.WithContext(database.WithScheduleWake(r.Context(), s.scheduleWake))
		}
		handler.ServeHTTP(w, r)
	})
}

// ConfigureScheduleWake is called once before serving HTTP requests.
func (s *Server) ConfigureScheduleWake(wake func()) { s.scheduleWake = wake }
func (s *Server) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
func (s *Server) Ready(w http.ResponseWriter, r *http.Request) {
	if e := s.pool.Ping(r.Context()); e != nil {
		fail(w, 503, "unavailable", "Database unavailable")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ready"})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": message, "requestId": w.Header().Get("X-Request-ID")}})
}
func internal(w http.ResponseWriter, err error) {
	if reporter, ok := w.(interface{ ReportError(error) }); ok {
		reporter.ReportError(err)
	}
	if observed, ok := w.(interface{ DiagnosticsEnabled() bool }); !ok || !observed.DiagnosticsEnabled() {
		slog.Error("request failed", "requestId", w.Header().Get("X-Request-ID"), "type", errorType(err))
	}
	fail(w, 500, "internal", "Something went wrong. Please try again.")
}
func errorType(err error) string {
	if err == nil {
		return "none"
	}
	return "database_or_internal"
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 16384)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		fail(w, 422, "validation", "Check the request fields")
		return false
	}
	if err := d.Decode(new(any)); !errors.Is(err, io.EOF) {
		fail(w, 422, "validation", "Send one JSON object")
		return false
	}
	return true
}
func tokenHash(v string) string { h := sha256.Sum256([]byte(v)); return hex.EncodeToString(h[:]) }
func equal(a, b string) bool    { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
