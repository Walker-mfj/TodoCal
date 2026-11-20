package diagnostics

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/otel/codes"
	sdk "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTraceParentageBoundAndPrivacy(t *testing.T) {
	rec := tracetest.NewSpanRecorder()
	p := sdk.NewTracerProvider(sdk.WithSampler(newBudgetSampler(1, 10)), sdk.WithSpanProcessor(rec))
	old := tracer
	tracer = p.Tracer("test")
	tracingEnabled.Store(true)
	defer func() { tracingEnabled.Store(false); tracer = old; _ = p.Shutdown(context.Background()) }()
	var b bytes.Buffer
	h := HTTP(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		SetRoute(r.Context(), "GET /api/v1/reports/period")
		tr := PGTracer{}
		for i := 0; i < 20; i++ {
			ctx := tr.TraceQueryStart(r.Context(), nil, pgx.TraceQueryStartData{SQL: "private SQL", Args: []any{"secret"}})
			tr.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{Err: context.DeadlineExceeded})
		}
		w.WriteHeader(500)
	}), slog.New(slog.NewJSONHandler(&b, nil)))
	req := httptest.NewRequest("GET", "/private?password=yes", nil)
	req.Header.Set("traceparent", "00-11111111111111111111111111111111-2222222222222222-01")
	h.ServeHTTP(httptest.NewRecorder(), req)
	spans := rec.Ended()
	if len(spans) != 9 {
		t.Fatalf("unbounded spans: %d", len(spans))
	}
	root := spans[8]
	if root.Parent().IsValid() || len(root.Links()) != 1 {
		t.Fatal("expected locally sampled root with remote link")
	}
	for _, s := range spans[:8] {
		if s.Parent().SpanID() != root.SpanContext().SpanID() || s.Status().Code != codes.Error {
			t.Fatal("bad parent/error status")
		}
	}
	data, _ := json.Marshal(spans)
	for _, bad := range []string{"private", "secret", "password"} {
		if strings.Contains(string(data), bad) || strings.Contains(b.String(), bad) {
			t.Fatal("private value leaked")
		}
	}
	if !strings.Contains(b.String(), root.SpanContext().TraceID().String()) {
		t.Fatal("missing correlation")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestLogSenderUnreachableNonblockingAndBounded(t *testing.T) {
	old := http.DefaultTransport
	started := make(chan struct{}, 1)
	http.DefaultTransport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		select {
		case started <- struct{}{}:
		default:
		}
		<-r.Context().Done()
		return nil, errors.New("secret exporter failure")
	})
	defer func() { http.DefaultTransport = old }()
	s := newLogSender("https://telemetry.example/", "token")
	p := []byte(`{"event":"http_request_completed","status_code":500,"password":"secret"}`)
	_, _ = s.Write(p)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("sender not started")
	}
	begin := time.Now()
	for i := 0; i < 1000; i++ {
		_, _ = s.Write(p)
	}
	if time.Since(begin) > time.Second {
		t.Fatal("request path blocked")
	}
	if len(s.queue) > 64 || s.dropped.Load() == 0 {
		t.Fatal("missing bounds/drops")
	}
	s.Close()
}
func TestLogSenderPayloadAndNoRetry(t *testing.T) {
	old := http.DefaultTransport
	received := make(chan []byte, 2)
	http.DefaultTransport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		b, _ := io.ReadAll(r.Body)
		received <- b
		return &http.Response{StatusCode: 429, Body: io.NopCloser(strings.NewReader("secret")), Header: make(http.Header)}, nil
	})
	defer func() { http.DefaultTransport = old }()
	s := newLogSender("https://telemetry.example/", "token")
	defer s.Close()
	_, _ = s.Write([]byte(`{"event":"http_request_completed","status_code":500,"password":"secret"}`))
	select {
	case b := <-received:
		if strings.Contains(string(b), "secret") {
			t.Fatal("leak")
		}
	case <-time.After(time.Second):
		t.Fatal("missing export")
	}
	select {
	case <-received:
		t.Fatal("retried")
	case <-time.After(20 * time.Millisecond):
	}
}
func TestDailyBudgets(t *testing.T) {
	s := newBudgetSampler(1, 2)
	for i := 0; i < 3; i++ {
		got := s.ShouldSample(sdk.SamplingParameters{ParentContext: context.Background()})
		if (got.Decision == sdk.RecordAndSample) != (i < 2) {
			t.Fatal("trace budget")
		}
	}
	b := dailyBudget{limit: 1}
	if !b.allow() || b.allow() {
		t.Fatal("log budget")
	}
}

func TestExportFlagsDefaultOff(t *testing.T) {
	var b bytes.Buffer
	out, close := ConfigureExports(func(string) string { return "" }, &b)
	defer close()
	if out != &b || tracingEnabled.Load() {
		t.Fatal("export enabled by default")
	}
}
func TestInvalidTraceContextIgnored(t *testing.T) {
	rec := tracetest.NewSpanRecorder()
	p := sdk.NewTracerProvider(sdk.WithSampler(newBudgetSampler(1, 1)), sdk.WithSpanProcessor(rec))
	old := tracer
	tracer = p.Tracer("test")
	tracingEnabled.Store(true)
	defer func() { tracingEnabled.Store(false); tracer = old; _ = p.Shutdown(context.Background()) }()
	var b bytes.Buffer
	h := HTTP(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}), slog.New(slog.NewJSONHandler(&b, nil)))
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("traceparent", "private-malformed")
	r.Header.Set("baggage", "password=secret")
	h.ServeHTTP(httptest.NewRecorder(), r)
	s := rec.Ended()[0]
	if len(s.Links()) != 0 {
		t.Fatal("malformed trace accepted")
	}
	for _, a := range s.Attributes() {
		if a.Key == "http.response.status_code" && a.Value.AsInt64() != 200 {
			t.Fatal("implicit status not captured")
		}
	}
}

func TestTraceReleaseMetadata(t *testing.T) {
	release := strings.Repeat("a", 40)
	legacy := strings.Repeat("b", 40)
	for _, tc := range []struct {
		name, release, environment, wantRelease, wantEnvironment string
	}{
		{"image release", release, "production", release, "production"},
		{"missing release ignores legacy", "", "staging", "unknown", "staging"},
		{"invalid release ignores legacy", "invalid", "development", "unknown", "development"},
		{"uppercase release", strings.Repeat("A", 40), "invalid", "unknown", "unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := map[string]string{
				"APP_RELEASE":       tc.release,
				"APP_ENV":           tc.environment,
				"RENDER_GIT_COMMIT": legacy,
			}
			res := traceResource(func(key string) string { return env[key] })
			got := make(map[string]string)
			for _, attr := range res.Attributes() {
				got[string(attr.Key)] = attr.Value.AsString()
			}
			if got["service.name"] != "todocal-api" ||
				got["service.version"] != tc.wantRelease ||
				got["deployment.environment.name"] != tc.wantEnvironment {
				t.Fatalf("unexpected trace resource metadata: %v", got)
			}
		})
	}
}
