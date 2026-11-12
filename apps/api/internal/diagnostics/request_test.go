package diagnostics

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestClassification(t *testing.T) {
	for _, tt := range []struct {
		err         error
		stage, want string
	}{
		{fmt.Errorf("private: %w", context.Canceled), "query", "request_cancelled"},
		{context.DeadlineExceeded, "pool_acquire", "db_pool_acquire_timeout"},
		{context.DeadlineExceeded, "query", "database_timeout"},
		{context.DeadlineExceeded, "unknown", "deadline_exceeded"},
		{&pgconn.PgError{Code: "23505", Message: "secret"}, "query", "database_constraint"},
		{&pgconn.PgError{Code: "08006"}, "query", "database_unavailable"},
		{&pgconn.PgError{Code: "57014"}, "query", "database_timeout"},
		{errors.New("private"), "unknown", "internal"},
	} {
		if got := Category(tt.err, tt.stage); got != tt.want {
			t.Errorf("%s: %s != %s", tt.stage, got, tt.want)
		}
	}
}

func TestHTTPCompletionPrivacyAndImplicitStatus(t *testing.T) {
	var b bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&b, nil))
	h := HTTP(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		SetRoute(r.Context(), "GET /api/v1/tasks/{id}")
		RecordError(r.Context(), errors.New("secret task SQL"))
		_, _ = w.Write([]byte("ok"))
	}), logger)
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/api/v1/tasks/private-id?secret=yes", nil)
	r.Header.Set("X-Request-ID", "secret")
	h.ServeHTTP(w, r)
	var got map[string]any
	if err := json.Unmarshal(b.Bytes(), &got); err != nil {
		t.Fatal(err, b.String())
	}
	if got["status_code"] != float64(200) || got["route"] != "GET /api/v1/tasks/{id}" || got["request_id"] != w.Header().Get("X-Request-ID") {
		t.Fatal(got)
	}
	if len(w.Header().Get("X-Request-ID")) != 24 || strings.Contains(b.String(), "secret") || strings.Contains(b.String(), "private-id") {
		t.Fatal(b.String())
	}
}

func TestUnknownRouteAndAbort(t *testing.T) {
	var b bytes.Buffer
	h := HTTP(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		SetRoute(r.Context(), "GET /private-user-value")
		panic(http.ErrAbortHandler)
	}), slog.New(slog.NewJSONHandler(&b, nil)))
	func() {
		defer func() {
			if recover() != http.ErrAbortHandler {
				t.Error("abort swallowed")
			}
		}()
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/private", nil))
	}()
	if strings.Contains(b.String(), "private") || !strings.Contains(b.String(), `"response_complete":false`) || !strings.Contains(b.String(), `"route":"unknown"`) {
		t.Fatal(b.String())
	}
}

func TestWriterCapabilitiesAndFlushStatus(t *testing.T) {
	var b bytes.Buffer
	w := httptest.NewRecorder()
	h := HTTP(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := w.(http.Hijacker); ok {
			t.Error("invented Hijacker")
		}
		if _, ok := w.(http.Pusher); ok {
			t.Error("invented Pusher")
		}
		if _, ok := w.(interface{ Unwrap() http.ResponseWriter }); !ok {
			t.Error("missing Unwrap")
		}
		w.(http.Flusher).Flush()
		w.WriteHeader(503)
	}), slog.New(slog.NewJSONHandler(&b, nil)))
	h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 200 || !strings.Contains(b.String(), `"status_code":200`) {
		t.Fatal(w.Code, b.String())
	}
}

func TestLoggerMetadataAllowlist(t *testing.T) {
	var b bytes.Buffer
	Logger(&b, "password=secret", "private environment").Info("test")
	if strings.Contains(b.String(), "secret") || strings.Contains(b.String(), "private") || !strings.Contains(b.String(), `"service":"api"`) {
		t.Fatal(b.String())
	}
}
func TestContextAllowlist(t *testing.T) {
	got := FilterContext(map[string]string{"route": "GET /api/v1/tasks/private", "request_id": "untrusted", "operation": "DROP TABLE secret", "db_stage": "private", "error_category": "password", "cookie": "secret"})
	if len(got) != 0 {
		t.Fatal(got)
	}
}
