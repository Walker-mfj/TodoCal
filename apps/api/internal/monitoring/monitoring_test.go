package monitoring

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/getsentry/sentry-go"
)

func TestSanitizeDiscardsPrivateFields(t *testing.T) {
	e := &sentry.Event{Message: "password secret", User: sentry.User{Email: "private@example.com"}, Contexts: map[string]sentry.Context{"extra": {"body": "private task"}}, Exception: []sentry.Exception{{Type: "TypeError", Value: "private task", Stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{{Filename: "https://app.example/_next/static/chunks/a.js?token=secret", Function: "save", Lineno: 42, Vars: map[string]interface{}{"secret": "yes"}, ContextLine: "private source"}}}}}}
	got := sanitize(e, "browser", "release1")
	b, _ := json.Marshal(got)
	for _, s := range []string{"password", "private", "secret", "token=", "ContextLine"} {
		if strings.Contains(string(b), s) {
			t.Fatalf("leaked %s: %s", s, b)
		}
	}
	if got.Exception[0].Stacktrace.Frames[0].Lineno != 42 {
		t.Fatal("lost stack")
	}
}
func TestReporterBoundsDuplicatesAndBurst(t *testing.T) {
	sent := make(chan *sentry.Event, 32)
	r := newReporter("release", func(context.Context) bool { return true }, func(e *sentry.Event) { sent <- e })
	for i := 0; i < 100; i++ {
		r.Report(&sentry.Event{Exception: []sentry.Exception{{Type: "Error", Stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{{Filename: "main.go", Lineno: i%20 + 1}}}}}}, "api")
	}
	r.Close()
	if len(sent) != 10 {
		t.Fatalf("want 10 distinct events, got %d", len(sent))
	}
}
func TestQuotaFailureDropsWithoutSending(t *testing.T) {
	r := newReporter("release", func(context.Context) bool { return false }, func(*sentry.Event) { t.Error("sent without budget") })
	r.Report(&sentry.Event{Exception: []sentry.Exception{{Type: "Error"}}}, "api")
	r.Close()
}
func TestRepeatedErrorOnlySentOnce(t *testing.T) {
	sent := make(chan *sentry.Event, 32)
	r := newReporter("release", func(context.Context) bool { return true }, func(e *sentry.Event) { sent <- e })
	for i := 0; i < 20; i++ {
		r.Report(&sentry.Event{Exception: []sentry.Exception{{Type: "Error"}}}, "api")
	}
	r.Close()
	if len(sent) != 1 {
		t.Fatal(len(sent))
	}
}
func TestClosedReporterDoesNotPanic(t *testing.T) {
	r := newReporter("r", func(context.Context) bool { return true }, func(*sentry.Event) {})
	r.Close()
	r.Report(&sentry.Event{}, "api")
	time.Sleep(time.Millisecond)
}

func TestBrowserReleaseSurvivesBackendDeploy(t *testing.T) {
	release := strings.Repeat("a", 40)
	got := sanitize(&sentry.Event{Release: release, Exception: []sentry.Exception{{Type: "Error"}}}, "browser", "new-backend")
	if got.Release != release {
		t.Fatal("browser source maps would use wrong release", got.Release)
	}
}

func TestTransportSendsOneScrubbedEventAndDoesNotRetry(t *testing.T) {
	var calls atomic.Int32
	bodies := make(chan string, 1)
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		b, _ := io.ReadAll(r.Body)
		bodies <- string(b)
		w.WriteHeader(429)
	}))
	defer srv.Close()
	transport := sentry.NewHTTPSyncTransport()
	transport.Configure(sentry.ClientOptions{Dsn: strings.Replace(srv.URL, "https://", "https://public@", 1) + "/1", HTTPClient: srv.Client()})
	r := newReporter("release", func(context.Context) bool { return true }, transport.SendEvent)
	r.Capture(errors.New("password=secret"))
	r.Close()
	if calls.Load() != 1 {
		t.Fatal("missing send or retried", calls.Load())
	}
	body := <-bodies
	if strings.Contains(body, "secret") || !strings.Contains(body, "exception") {
		t.Fatal("invalid payload", body)
	}
}
