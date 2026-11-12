package controllers

import (
	"context"
	"crypto/subtle"
	"net/http"
	"time"
)

// ConfigureJobs installs an authenticated scheduler callback. A missing/short
// credential disables the endpoint; ordinary session cookies never authorize it.
func (s *Server) ConfigureJobs(secret string, run func(context.Context) (any, error)) {
	s.jobsSecret = secret
	s.runJobs = run
}
func (s *Server) RunJobs(w http.ResponseWriter, r *http.Request) {
	if len(s.jobsSecret) < 32 || s.runJobs == nil {
		fail(w, 503, "unavailable", "Scheduled jobs are not configured")
		return
	}
	expected := "Bearer " + s.jobsSecret
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte(expected)) != 1 {
		fail(w, 403, "forbidden", "Scheduler authorization required")
		return
	}
	if !s.jobsMu.TryLock() {
		fail(w, 409, "busy", "A scheduled job is already running")
		return
	}
	defer s.jobsMu.Unlock()
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	result, err := s.runJobs(ctx)
	if err != nil {
		if reporter, ok := w.(interface{ ReportError(error) }); ok {
			reporter.ReportError(err)
		}
		fail(w, 503, "unavailable", "Scheduled job incomplete; retry on the next tick")
		return
	}
	writeJSON(w, 200, result)
}
