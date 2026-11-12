# TodoCal monitoring

Better Stack application: https://errors.betterstack.com/team/t622845/applications/2811083/data-ingestion
Errors: https://errors.betterstack.com/team/t622845/errors
Monitors: https://incidents.betterstack.com/team/t622845/monitors

## What is collected

Browser unhandled errors, React error boundaries, Go internal errors and panics. Events contain error types, scrubbed stack frames, service name and build revision. Raw error messages, cookies, request bodies, user identities, breadcrumbs, source locals and headers are removed. Source maps are uploaded privately with owner approval; they contain frontend source code. No general log stream, replay, analytics or tracing is enabled.

## Limits

- All frontend and API events share **1000 send attempts per UTC day**, stored atomically in PostgreSQL. Maximum 31,000 attempts in a 31-day month. This bounds this application's sender, not other apps in the Better Stack account or anyone with its ingest credential.
- Reserve before sending; provider errors never refund the budget. No retries. Database failure drops monitoring events and preserves app functionality.
- Per API process: 10 distinct events/minute, suppress repeated sanitized stacks for 5 minutes, queue at most 16 events. The durable daily budget also applies across restarts/instances.
- Browser: 5 reports/minute, at most 20 per page load, suppress duplicates for 5 minutes. Refreshing resets this local limit but cannot reset the shared daily budget.
- Ingestion: same-origin POST only, no cookies sent, max 32 KiB, at most 20 submissions/minute per API process before parsing. Origin is not authentication; this endpoint can receive spoofed requests. It cannot forward to arbitrary URLs or bypass the outbound daily budget.
- These limits apply to monitoring, not normal task operations. Caps and sampling necessarily discard some errors; grouped counts are sampled, not exact totals.
- Better Stack spike protection is an additional safeguard, not the hard daily cap.

## Uptime and alerts

Website monitor `5131235` checks the frontend for TodoCal. API/database monitor `5131236` checks `/readyz` for `"status":"ready"`. Both run every 1800 seconds, request timeout 120 seconds, incident confirmation 180 seconds, recovery 60 seconds. Email only. A normal schedule is 96 checks/day total before retries/confirmation probes; outage detection may take over 30 minutes. Render cold starts are expected. Checks can wake Render and Neon, consuming some free hours/compute.

Errors integration `469405` sends email incidents for new or reopened errors, scoped to TodoCal; it does not notify on every occurrence.

## Configuration and deploy

`BETTER_STACK_DSN` is a Render secret. Empty or invalid configuration disables error reporting; invalid values emit a sanitized warning. No DSN/provider credential is embedded in browser assets. Render supplies `RENDER_GIT_COMMIT` for API releases.

From `deploy/cloudflare`, `npm run build` builds production assets with `NEXT_PUBLIC_MONITORING_ENABLED=true` and the current Git SHA as `NEXT_PUBLIC_RELEASE`. Source maps and matching bundles are copied to ignored `.local/sourcemaps/<SHA>`; all `.map` files are then removed from the public `apps/web/out` directory.

Set `BETTER_STACK_API_TOKEN` in the process environment (never Git). `npm run upload:sourcemaps` uploads private source maps to the configured Better Stack team/application. `npm run deploy` runs build, upload, then Wrangler deploy in order and stops on failures. Commit frontend changes before deployment so a revision uniquely identifies the release. The token is only needed for build-time upload; never place it in NEXT_PUBLIC_* variables or Cloudflare assets.

To disable collection, remove `BETTER_STACK_DSN` on Render and rebuild frontend with monitoring disabled if needed; pause uptime checks separately. Existing stored errors remain in Better Stack under its retention settings.

## Verification

Run web tests/typecheck, Go race tests with the dedicated test database, static build, and `node --test deploy/cloudflare/worker.test.mjs`. Tests cover duplicate and burst dropping, durable concurrent quota, day rollover, privacy scrubbing, provider rejection without retry, invalid config, malformed/oversized intake, and panic response behavior. Send one synthetic event through the live endpoint and confirm it appears in Better Stack. Never trigger a business error or use real user data for a smoke test.

## Stage 1 request and database diagnostics

Set `OBSERVABILITY_ENABLED=true` on the API to enable JSON stdout request completion records and pgx acquire/query diagnostics. It defaults off; remove the flag or set it to `false` to restore existing logging. Set `APP_ENV=production` (also accepts `staging` or `development`); unknown environment/release metadata becomes `unknown`. `RENDER_GIT_COMMIT` must be a full lowercase Git SHA.

The observer encloses the proxy and security middleware, so rejected 403/415 requests have the same server-generated ID in the response and completion log. Only registered method/route templates are logged; early rejections and unmatched routes use `unknown`. When adding a route, add its template to `internal/diagnostics/routes.go`; an omitted template safely falls back to `unknown`.

Each business request emits one completion record. Successful `/healthz`, `/readyz`, `/internal/jobs`, and monitoring-ingest calls are omitted; their failures are retained. A panic after partial output records `response_complete=false` with the already-written status; status `0` means no final response status was written before an abort. `duration_ms` is wall time measured with the monotonic clock. No raw paths, query parameters, SQL, arguments, credentials, task text or error messages are included in these records.

`db_acquire_ms` and `db_query_ms` are sums across that request's calls, not durations of a single SQL statement. Query timing includes consuming/closing result rows. `db_stage` identifies the first unexpected failed operation, and `db_context_already_done` indicates at least one DB call started with a canceled/expired context. Expected `pgx.ErrNoRows` does not set a failure category. Category changes are diagnostic only; API response status and domain errors are unchanged.

A `db_pool_summary` record every 60 seconds provides pool sizes plus interval deltas for empty/canceled acquisitions and cumulative acquire duration. These are process-wide metrics, not per-request timings. The summary goroutine stops before pool shutdown.

API error events allowlist `request_id`, `route`, `operation`, `error_category` and `db_stage`. The request ID is excluded from grouping and local deduplication; route/category/stage distinguish independent failures. Browser-supplied server diagnostic fields are discarded. Existing 1000/day shared send-attempt quota, queue bounds and rate suppression are unchanged.

### Investigation

1. Open an error alert and note its time window, release, route, category, DB stage and request ID.
2. Search Render logs for that `request_id`. Check status, completion state, acquire/query totals and whether the DB context was already canceled.
3. Compare surrounding `db_pool_summary` records. Empty/canceled acquire deltas suggest connection contention; they alone do not prove SQL slowness. Compare Render events and Neon metrics for the same window.
4. Record the confirmed cause separately from hypotheses. A client cancellation is not by itself a database outage.
5. Disable `OBSERVABILITY_ENABLED` if volume or overhead is unacceptable; the existing capped Errors reporter continues operating.

The Stage 1 flag alone does not provision a Better Stack log source or export traces. Stage 2 adds independent exporter flags, bounded queues/volume budgets and server-controlled sampling below. Use synthetic values for verification; do not intentionally fail a real user's task.

## Stage 2 exporters (opt-in)

Stage 2 adds a single direct Go → Better Stack log pipeline and the official OpenTelemetry OTLP/HTTP trace exporter. Do not also enable Render log forwarding for this service. Both exporters require Stage 1 `OBSERVABILITY_ENABLED=true` and are otherwise disabled independently.

| Setting | Purpose |
| --- | --- |
| `OBSERVABILITY_LOG_EXPORT_ENABLED=true` | Enable sanitized asynchronous log export |
| `BETTER_STACK_LOG_ENDPOINT` | Full HTTPS ingest URL of a separate Telemetry log source |
| `BETTER_STACK_LOG_TOKEN` | That source's bearer token; not the Errors DSN |
| `OBSERVABILITY_TRACE_EXPORT_ENABLED=true` | Enable OTLP/HTTP export |
| `OTEL_TRACE_ENDPOINT` | Full HTTPS OTLP trace URL, including `/v1/traces` where required |
| `OTEL_TRACE_TOKEN` | Trace endpoint bearer token |

URLs with user credentials, query strings or fragments are rejected. Invalid settings disable the affected exporter; they do not prevent API startup. Store credentials only in Render secrets. No provider resources are provisioned automatically.

Log export accepts only allowlisted request completions and pool summaries, samples successful completions at 1/100, and retains failures subject to a 10,000-record UTC-day send-attempt limit. Queue capacity is 64 records, record size at most 8 KiB, timeout 2 seconds, no retries or redirects. `telemetry_dropped_total` includes queue, budget, serialization and delivery failures. Shutdown cancels pending work and may discard buffered records. Stdout remains available during export outages.

Tracing samples 5% of server requests, at most 1,000 sampled roots per UTC day per process, with up to 8 named DB spans per request on calendar/day details/period report/tasks list/auth-me operations. Spans contain route, status and sanitized error categories, never raw exceptions, SQL, parameters or headers. Query spans include row consumption. Queue capacity is 128 spans, batches at most 32, timeout 2 seconds, no retries, shutdown at most 3 seconds. Export failures increment `trace_export_errors_total` in local pool summaries; SDK queue overflow may also drop spans. Head sampling cannot retain every error.

Incoming valid W3C traceparent is retained as a link to a new locally sampled root, not as the parent: this prevents both sampled-bit and caller-selected trace-ID sampling bypass. Baggage is not extracted. Go→DB parentage is preserved. The existing Cloudflare proxy already forwards trace headers; malformed values are ignored at Go ingress. Browser instrumentation remains optional and is not added here.

These budgets are **per process and reset on restart**, not durable account-wide billing caps. Before enabling, configure provider retention/quota and account for instance count and restarts. Start with a synthetic failed request in a controlled environment, match its request ID across Render and the log source, then verify a sampled trace and parentage. Alert routing/thresholds should be configured after measuring traffic; existing Errors quota and alert integration remain unchanged. Disable either exporter flag independently to roll back.
