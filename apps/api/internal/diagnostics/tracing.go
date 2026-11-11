package diagnostics

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdk "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

type budgetSampler struct {
	ratio  sdk.Sampler
	budget dailyBudget
}

func newBudgetSampler(ratio float64, limit int) *budgetSampler {
	return &budgetSampler{ratio: sdk.TraceIDRatioBased(ratio), budget: dailyBudget{limit: limit}}
}
func (s *budgetSampler) ShouldSample(p sdk.SamplingParameters) sdk.SamplingResult {
	parent := trace.SpanContextFromContext(p.ParentContext)
	if parent.IsValid() && !parent.IsRemote() {
		if parent.IsSampled() {
			return sdk.SamplingResult{Decision: sdk.RecordAndSample}
		}
		return sdk.SamplingResult{Decision: sdk.Drop}
	}
	// Local random root trace ID prevents a caller choosing IDs to beat ratio sampling.
	result := s.ratio.ShouldSample(p)
	if result.Decision == sdk.RecordAndSample && !s.budget.allow() {
		result.Decision = sdk.Drop
	}
	return result
}
func (s *budgetSampler) Description() string { return "server-ratio-and-daily-budget" }

var tracer = otel.Tracer("todocal/api")
var tracingEnabled atomic.Bool
var traceExportErrors atomic.Uint64

// ConfigureExports creates independent, opt-in exporters. Invalid configuration
// fails closed without preventing API startup. No credentials enter logs.
func ConfigureExports(getenv func(string) string, stdout io.Writer) (io.Writer, func()) {
	var logs *logSender
	var provider *sdk.TracerProvider
	out := stdout
	if getenv("OBSERVABILITY_LOG_EXPORT_ENABLED") == "true" {
		endpoint, token := getenv("BETTER_STACK_LOG_ENDPOINT"), getenv("BETTER_STACK_LOG_TOKEN")
		if validEndpoint(endpoint) && token != "" {
			logs = newLogSender(endpoint, token)
			out = io.MultiWriter(stdout, logs)
		} else {
			slog.Warn("log exporter disabled: invalid configuration")
		}
	}
	if getenv("OBSERVABILITY_TRACE_EXPORT_ENABLED") == "true" {
		endpoint, token := getenv("OTEL_TRACE_ENDPOINT"), getenv("OTEL_TRACE_TOKEN")
		if validEndpoint(endpoint) && token != "" {
			exp, err := otlptracehttp.New(context.Background(), otlptracehttp.WithEndpointURL(endpoint), otlptracehttp.WithHTTPClient(&http.Client{Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}), otlptracehttp.WithHeaders(map[string]string{"Authorization": "Bearer " + token}), otlptracehttp.WithTimeout(2*time.Second), otlptracehttp.WithRetry(otlptracehttp.RetryConfig{Enabled: false}))
			if err == nil {
				otel.SetErrorHandler(otel.ErrorHandlerFunc(func(error) { traceExportErrors.Add(1) }))
				release := getenv("RENDER_GIT_COMMIT")
				if !revisionPattern.MatchString(release) {
					release = "unknown"
				}
				environment := getenv("APP_ENV")
				switch environment {
				case "production", "staging", "development":
				default:
					environment = "unknown"
				}
				provider = sdk.NewTracerProvider(sdk.WithSampler(newBudgetSampler(.05, 1000)), sdk.WithResource(resource.NewSchemaless(attribute.String("service.name", "todocal-api"), attribute.String("service.version", release), attribute.String("deployment.environment.name", environment))), sdk.WithBatcher(exp, sdk.WithMaxQueueSize(128), sdk.WithMaxExportBatchSize(32), sdk.WithBatchTimeout(time.Second), sdk.WithExportTimeout(2*time.Second)), sdk.WithRawSpanLimits(sdk.SpanLimits{AttributeCountLimit: 12, AttributeValueLengthLimit: 128, EventCountLimit: 0, LinkCountLimit: 1}))
				tracer = provider.Tracer("todocal/api")
				tracingEnabled.Store(true)
			} else {
				slog.Warn("trace exporter disabled: invalid configuration")
			}
		} else {
			slog.Warn("trace exporter disabled: invalid configuration")
		}
	}
	return out, func() {
		tracingEnabled.Store(false)
		if logs != nil {
			logs.Close()
		}
		if provider != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_ = provider.Shutdown(ctx)
		}
	}
}
func startRequestTrace(ctx context.Context, header propagation.TextMapCarrier) (context.Context, trace.Span) {
	if !tracingEnabled.Load() {
		return ctx, nil
	}
	// Extract with the standard propagator, but start a locally sampled root.
	// Incoming traceparent is intentionally not made authoritative for sampling.
	remote := propagation.TraceContext{}.Extract(context.Background(), header)
	opts := []trace.SpanStartOption{trace.WithNewRoot(), trace.WithSpanKind(trace.SpanKindServer)}
	if sc := trace.SpanContextFromContext(remote); sc.IsValid() {
		opts = append(opts, trace.WithLinks(trace.Link{SpanContext: sc}))
	}
	return tracer.Start(ctx, "api.request", opts...)
}
func finishSpan(span trace.Span, category string) {
	if span == nil {
		return
	}
	if category != "" {
		span.SetStatus(codes.Error, category)
	}
	span.End()
}
