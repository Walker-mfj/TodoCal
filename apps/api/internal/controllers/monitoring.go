package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"focuscalendar/internal/diagnostics"
	"focuscalendar/internal/monitoring"
	"focuscalendar/internal/services"

	"github.com/getsentry/sentry-go"
)

// One atomic reservation shared by all instances and event sources. Fail closed.

func (s *Server) EnableMonitoring(dsn, release string) func() {
	r, err := monitoring.New(dsn, release, func(ctx context.Context) bool { return services.ReserveMonitoring(ctx, s.pool, monitoring.DailyLimit) })
	if err != nil {
		slog.Warn("monitoring disabled: invalid configuration")
		return func() {}
	}
	s.monitor = r
	return r.Close
}

type ingestLimiter struct {
	mu     sync.Mutex
	window time.Time
	count  int
}

func (l *ingestLimiter) allow() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if now.Sub(l.window) >= time.Minute {
		l.window = now
		l.count = 0
	}
	if l.count >= 20 {
		return false
	}
	l.count++
	return true
}
func (s *Server) IngestError(w http.ResponseWriter, r *http.Request) {
	if s.monitor == nil || !s.ingestLimit.allow() {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32768)
	var payload struct {
		Release   string `json:"release"`
		Exception struct {
			Values []sentry.Exception `json:"values"`
		} `json:"exception"`
	}
	d := json.NewDecoder(r.Body)
	if err := d.Decode(&payload); err != nil || len(payload.Exception.Values) == 0 || len(payload.Exception.Values) > 3 {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err := d.Decode(new(any)); !errors.Is(err, io.EOF) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	s.monitor.Report(&sentry.Event{Release: payload.Release, Exception: payload.Exception.Values}, "browser")
	w.WriteHeader(http.StatusNoContent)
}

type monitoredWriter struct {
	http.ResponseWriter
	reporter *monitoring.Reporter
	ctx      context.Context
	written  bool
}

func (w *monitoredWriter) WriteHeader(code int) { w.written = true; w.ResponseWriter.WriteHeader(code) }
func (w *monitoredWriter) Write(b []byte) (int, error) {
	w.written = true
	return w.ResponseWriter.Write(b)
}
func (w *monitoredWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *monitoredWriter) ReportError(err error) {
	diagnostics.RecordError(w.ctx, err)
	w.reporter.CaptureContext(err, diagnostics.SafeContext(w.ctx))
}
func (w *monitoredWriter) DiagnosticsEnabled() bool { return diagnostics.Active(w.ctx) }

func (s *Server) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mw := &monitoredWriter{ResponseWriter: w, reporter: s.monitor, ctx: r.Context()}
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				if !diagnostics.Active(r.Context()) {
					slog.Error("request panic", "requestId", w.Header().Get("X-Request-ID"))
				}
				diagnostics.RecordPanic(r.Context())
				s.monitor.PanicContext(diagnostics.SafeContext(r.Context()))
				if mw.written {
					panic(http.ErrAbortHandler)
				}
				fail(mw, 500, "internal", "Something went wrong. Please try again.")
			}
		}()
		next.ServeHTTP(mw, r)
	})
}
