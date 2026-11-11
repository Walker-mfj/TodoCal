package monitoring

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/getsentry/sentry-go"
)

func TestSafeDiagnosticContextAndDedupe(t *testing.T) {
	sent := make(chan *sentry.Event, 8)
	r := newReporter("release", func(context.Context) bool { return true }, func(e *sentry.Event) { sent <- e })
	for _, route := range []string{"GET /api/v1/calendar", "GET /api/v1/reports/period"} {
		for _, id := range []string{strings.Repeat("a", 24), strings.Repeat("b", 24)} {
			r.Report(&sentry.Event{Exception: []sentry.Exception{{Type: "Error", Value: "secret"}}, Tags: map[string]string{"route": route, "request_id": id, "error_category": "database_timeout", "db_stage": "query", "password": "secret", "operation": "private task"}}, "api")
		}
	}
	r.Close()
	if len(sent) != 2 {
		t.Fatalf("request IDs must not split dedupe; independent routes must: %d", len(sent))
	}
	for len(sent) > 0 {
		event := <-sent
		b, _ := json.Marshal(event)
		if strings.Contains(string(b), "secret") || strings.Contains(string(b), "private") || event.Tags["request_id"] == "" || event.Tags["error_category"] != "database_timeout" {
			t.Fatal(string(b))
		}
	}
}
func TestBrowserCannotSupplyServerDiagnostics(t *testing.T) {
	e := sanitize(&sentry.Event{Tags: map[string]string{"request_id": strings.Repeat("a", 24), "route": "GET /api/v1/calendar"}}, "browser", "release")
	if e.Tags["route"] != "" || e.Tags["request_id"] != "" {
		t.Fatal(e.Tags)
	}
}
