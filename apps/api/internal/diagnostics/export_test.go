package diagnostics

import (
	"context"
	sdk "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"strings"
	"testing"
)

func TestRemoteParentCannotForceSampling(t *testing.T) {
	s := newBudgetSampler(0, 100)
	ctx := trace.ContextWithRemoteSpanContext(context.Background(), trace.NewSpanContext(trace.SpanContextConfig{TraceID: trace.TraceID{1}, SpanID: trace.SpanID{1}, TraceFlags: trace.FlagsSampled, Remote: true}))
	if s.ShouldSample(sdk.SamplingParameters{ParentContext: ctx}).Decision != sdk.Drop {
		t.Fatal("remote parent forced sample")
	}
}
func TestTelemetryEndpointValidation(t *testing.T) {
	for _, v := range []string{"http://host", "https://user:password@host", "https://host?secret=yes", "https://host/#fragment"} {
		if validEndpoint(v) {
			t.Fatal(v)
		}
	}
	if !validEndpoint("https://telemetry.example/v1/traces") {
		t.Fatal("valid endpoint rejected")
	}
}
func TestExportAllowlist(t *testing.T) {
	got := safeLog(map[string]any{"event": "http_request_completed", "route": "GET /api/v1/tasks/secret", "request_id": strings.Repeat("a", 24), "password": "secret", "status_code": float64(500)})
	if _, ok := got["password"]; ok {
		t.Fatal(got)
	}
	if _, ok := got["route"]; ok {
		t.Fatal(got)
	}
}
