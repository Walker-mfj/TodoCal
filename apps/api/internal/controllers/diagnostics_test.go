package controllers

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"focuscalendar/internal/diagnostics"
	"focuscalendar/internal/middleware"
)

func TestDiagnosticsSecurityRejections(t *testing.T) {
	for _, tt := range []struct {
		origin, content string
		want            int
	}{{"https://bad", "application/json", 403}, {"https://app", "text/plain", 415}} {
		var b bytes.Buffer
		s := New(nil, "https://app", false)
		h := diagnostics.HTTP(s.Handler(), slog.New(slog.NewJSONHandler(&b, nil)))
		r := httptest.NewRequest("POST", "/api/v1/tasks?private=yes", strings.NewReader("secret"))
		r.Header.Set("Origin", tt.origin)
		r.Header.Set("Content-Type", tt.content)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		var got map[string]any
		if err := json.Unmarshal(b.Bytes(), &got); err != nil {
			t.Fatal(err, b.String())
		}
		if w.Code != tt.want || got["status_code"] != float64(tt.want) || got["request_id"] != w.Header().Get("X-Request-ID") {
			t.Fatal(got, w.Header(), w.Code)
		}
		if strings.Contains(b.String(), "private") || strings.Contains(b.String(), "secret") {
			t.Fatal(b.String())
		}
	}
}
func TestDiagnosticsProxyRejection(t *testing.T) {
	var b bytes.Buffer
	s := New(nil, "https://app", false)
	h := diagnostics.HTTP(middleware.ProxyHandler(s.Handler(), strings.Repeat("x", 32)), slog.New(slog.NewJSONHandler(&b, nil)))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/tasks", nil))
	if w.Code != 403 || !strings.Contains(b.String(), `"status_code":403`) || w.Header().Get("X-Request-ID") == "" {
		t.Fatal(b.String())
	}
}
func TestDiagnosticsRouteBeforeError(t *testing.T) {
	var b bytes.Buffer
	s := New(nil, "https://app", false)
	h := diagnostics.HTTP(s.Handler(), slog.New(slog.NewJSONHandler(&b, nil)))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/reports/days/2001-02-03?private=yes", nil))
	if w.Code != http.StatusUnauthorized || !strings.Contains(b.String(), `"route":"GET /api/v1/reports/days/{date}"`) || strings.Contains(b.String(), "2001-02-03") {
		t.Fatal(b.String())
	}
}

func TestDiagnosticsRecoveredPanic(t *testing.T) {
	var b bytes.Buffer
	s := New(nil, "https://app", false)
	h := diagnostics.HTTP(s.observe(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { panic("secret task") })), slog.New(slog.NewJSONHandler(&b, nil)))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 500 || strings.Contains(b.String(), "secret") || !strings.Contains(b.String(), `"error_category":"panic"`) {
		t.Fatal(b.String())
	}
	if strings.Count(b.String(), "http_request_completed") != 1 {
		t.Fatal("duplicate completion")
	}
}
