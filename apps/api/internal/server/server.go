package server

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	pool   *pgxpool.Pool
	origin string
	secure bool
	now    func() time.Time
}

func New(p *pgxpool.Pool, origin string, secure bool) *Server {
	return &Server{pool: p, origin: strings.TrimRight(origin, "/"), secure: secure, now: time.Now}
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := s.pool.Ping(r.Context()); err != nil {
			fail(w, 503, "unavailable", "Database unavailable")
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ready"})
	})
	mux.HandleFunc("POST /api/v1/auth/register", s.register)
	mux.HandleFunc("POST /api/v1/auth/login", s.login)
	mux.HandleFunc("GET /api/v1/auth/me", s.me)
	mux.HandleFunc("POST /api/v1/auth/logout", s.logout)
	mux.HandleFunc("POST /api/v1/auth/password", s.password)
	mux.HandleFunc("GET /api/v1/focus", s.focusState)
	mux.HandleFunc("POST /api/v1/focus", s.startFocus)
	mux.HandleFunc("POST /api/v1/focus/{id}/{action}", s.changeFocus)
	mux.HandleFunc("GET /api/v1/series/{id}", s.getSeries)
	mux.HandleFunc("POST /api/v1/series", s.createSeries)
	mux.HandleFunc("POST /api/v1/series/{id}/stop", s.stopSeries)
	mux.HandleFunc("GET /api/v1/calendar", s.calendar)
	mux.HandleFunc("GET /api/v1/reports/days/{date}", s.dayDetails)
	mux.HandleFunc("POST /api/v1/tasks/{id}/schedule", s.scheduleTask)
	mux.HandleFunc("POST /api/v1/undo/{id}", s.undoSchedule)
	mux.HandleFunc("GET /api/v1/tasks", s.listTasks)
	mux.HandleFunc("POST /api/v1/tasks", s.createTask)
	mux.HandleFunc("GET /api/v1/tasks/{id}", s.getTask)
	mux.HandleFunc("PATCH /api/v1/tasks/{id}", s.editTask)
	mux.HandleFunc("DELETE /api/v1/tasks/{id}", s.deleteTask)
	mux.HandleFunc("POST /api/v1/tasks/{id}/completion", s.completeTask)
	mux.HandleFunc("GET /api/v1/groups", s.listGroups)
	mux.HandleFunc("POST /api/v1/groups", s.createGroup)
	mux.HandleFunc("PATCH /api/v1/groups/{id}", s.editGroup)
	mux.HandleFunc("DELETE /api/v1/groups/{id}", s.deleteGroup)
	mux.HandleFunc("GET /api/v1/settings", s.getSettings)
	mux.HandleFunc("PATCH /api/v1/settings", s.editSettings)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Request-ID", randomToken(12))
		if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
			if r.Header.Get("Origin") != s.origin {
				fail(w, 403, "origin", "Request origin is not allowed")
				return
			}
			if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				fail(w, 415, "content_type", "Use application/json")
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": message, "requestId": w.Header().Get("X-Request-ID")}})
}
func internal(w http.ResponseWriter, err error) {
	slog.Error("request failed", "requestId", w.Header().Get("X-Request-ID"), "type", errorType(err))
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
func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("secure random unavailable")
	}
	return hex.EncodeToString(b)
}
func tokenHash(v string) string { h := sha256.Sum256([]byte(v)); return hex.EncodeToString(h[:]) }
func equal(a, b string) bool    { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
