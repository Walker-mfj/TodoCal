# TodoCal — Observability Improvement Plan

> **Status:** Proposal (not implemented)
>
> **Scope:** Production observability for Cloudflare-hosted Next.js/edge proxy, Go API on Render, and Neon PostgreSQL. Implement in two incremental stages without changing product behavior.
>
> **Related:** [Current monitoring contract](../../deploy/monitoring.md), [tech stack](techStack.md), [architecture checks](qualityChecks.md), [folder structure](folderStructure.md).

## 1. Decision and goals

**Recommendation:** Implement both stages, in order, but keep instrumentation intentionally narrow. Stage 1 improves the quality of existing error reports and Render stdout logs; Stage 2 adds **one** centralized log ingestion path and selected distributed spans. Do **not** replace the existing Sentry-compatible Better Stack Errors ingestion or introduce a new general monitoring framework.

Success criterion: starting from an error alert, an engineer can identify the affected API route/operation/release, whether the failure occurred waiting for a pool connection or while executing a DB operation, the relevant deadline/cancellation signal, and the related structured request log, without exposing private task content or credentials.

This is a design proposal. A subsequent implementation PR should be feature-flagged, verified locally, and reviewed for privacy and telemetry cost before enabling production ingestion.

## 2. Evidence from production (November 2026)

The following is **observed**, not proof of a specific root cause:

| UTC time | Better Stack exception stack / type | Matching Render app logs |
| --- | --- | --- |
| 2026-11-08 07:04:13–07:04:33 | `DayDetails → authenticate` and `DayDetails → view` | Four `request failed` entries with `type=database_or_internal` |
| 2026-11-09 14:22:18–14:22:19 | `PeriodReport → view`, including `pgconn.errTimeout` and `pgconn.contextAlreadyDoneError`; `Calendar → view` | Four `request failed` entries with `type=database_or_internal` |

The API continued emitting scheduled-job logs around these groups, and Render did not surface an API restart/crash event for those windows. The November 9 timeout is consistent with a DB/request-context failure but does **not** establish whether pool acquisition, SQL execution, network, or a cancelled upstream request was the primary cause. The query-level timing is currently missing. Historical Render app logs for some October/early November incidents were not available in the queried windows. Better Stack exception event text says `Error details removed for privacy` by design.

**Existing code behind the gaps:**

- `apps/api/internal/middleware/security.go` generates a response `X-Request-ID`; it is not carried as a consistent request-scoped diagnostic context.
- `apps/api/internal/controllers/server.go` uses `slog.Error("request failed", "requestId", ..., "type", errorType(err))`, but `errorType` always returns `database_or_internal`.
- `apps/api/internal/controllers/monitoring.go` wraps errors and sends them through `Reporter.Capture`; the reporter is best-effort.
- `apps/api/internal/monitoring/monitoring.go` deliberately removes raw messages, headers, and user identities. Preserve this protection. Its sanitized events currently have too little safe context to distinguish DB stages.
- `apps/api/cmd/api/main.go` creates a `pgxpool.Pool`, with HTTP server `ReadTimeout=15s` and `WriteTimeout=30s`. Neither value alone proves the observed timeout.
- `deploy/monitoring.md` documents error-event caps: 1000 attempts/day shared by browser and API, per-process suppression and a bounded asynchronous queue. These limits must not silently change.
- Better Stack currently has an Errors application for TodoCal; a separate TodoCal API log stream and OpenTelemetry traces are **not** part of the documented production setup.

## 3. Stage 1 — Structured API logs and DB diagnostics (P0)

### 3.1 HTTP request boundary

Extend the existing middleware/observer rather than adding an independent HTTP framework.

For every completed API request, log one bounded structured completion record (or sample successful requests), including:

| Field | Source and rule |
| --- | --- |
| `event` | Stable enum, e.g. `http_request_completed` |
| `service`, `environment`, `release` | Config/deploy metadata; omit secrets |
| `request_id` | Existing server-generated `X-Request-ID`; propagate into request context, response, downstream logs and optional error-event safe context |
| `method`, `route` | HTTP method and **registered route template**, not raw URI, path parameters or query string |
| `status_code`, `duration_ms` | Status captured with `ResponseWriter` wrapper, monotonic elapsed time |
| `error_category`, `operation` | Controlled vocabulary; only on failures |
| `trace_id` | Optional Stage 2 correlation field, never mandatory for Stage 1 |

**Ordering/invariants:** `Security` already creates a request ID outside `observe`, so reusing that value is preferable to generating a second ID. Ensure status is captured even on implicit 200 responses, panic recovery, and errors handled by `domainError`; preserve `http.Flusher`, `http.Hijacker`, `http.Pusher` and `Unwrap` semantics when wrapping a writer. Avoid double-counting a failure in the completion log and the error reporter. Health checks, readiness checks, job endpoints, and monitoring ingest need separate noise/sampling rules. If route templates cannot be determined reliably, emit a fixed `unknown` rather than raw user-supplied paths.

### 3.2 Safe, stable error classification

Replace the blanket `database_or_internal` with a small, stable category set without exposing `err.Error()`:

- `request_cancelled` and `deadline_exceeded` (using `errors.Is` for `context.Canceled` / `context.DeadlineExceeded`);
- `db_pool_acquire_timeout` when the connection-acquire stage is known to fail;
- `database_timeout`, `database_unavailable`, `database_constraint` when supported by typed DB errors or explicit operation boundaries;
- `internal` for unknown failures; expected validation/auth/conflict responses retain their existing domain codes and should not be noisy error incidents.

Handle timeout via supported public interfaces (e.g. `net.Error`) and `pgx` public types; **do not depend on unexported `pgconn` implementation types**. Always record the failed stage separately (`pool_acquire`, `query`, `scan`, `transaction`, `unknown`). Classifications are diagnostics, **not** new public API error codes; preserve existing client HTTP status and safe messages.

Retain exception type and scrubbed stack frames. Enrich Better Stack error events only through an explicit allowlist (e.g. normalized route, `operation`, `error_category`, release, optional correlation ID). Never attach original exception messages, SQL strings, stack locals, arbitrary user-provided labels, authorization/session headers, passwords, cookies, task titles, dates or query parameter values. Keep high-cardinality `request_id` out of alert grouping/fingerprints. Review and test the deduplication key so that meaningful independent failures are not collapsed because they all terminate in `Reporter.Capture`.

### 3.3 PostgreSQL visibility

Start with existing `pgxpool.Stat()` (no new storage system). Record aggregate or sampled metrics:

- `AcquiredConns`, `IdleConns`, `TotalConns`, `MaxConns`;
- deltas of `EmptyAcquireCount` and `CanceledAcquireCount`;
- deltas of `AcquireDuration`, with interval timestamps; do not mislabel cumulative values as single-request timings.

Add **narrow, named** instrumentation around the shared service/repository transaction boundary and the specific high-value operations: `calendar.view`, `day_details.view`, `period_report.view`, `tasks.list`, `auth.me`. Distinguish wait-for-acquire vs query/transaction duration only when separately measured; do not claim DB query duration from the total request duration. Avoid logging raw SQL, bind values, account IDs or private business data. Keep instrumentation outside account locking/transaction behavior, or preserve lock ordering and error semantics exactly.

Diagnostics should answer:
1. Did the request context already have an error when DB work started?
2. Did acquisition or query execution expire/cancel?
3. What was the named operation, elapsed time and pool state?
4. Was this isolated or correlated across endpoints?

### 3.4 Stage 1 acceptance tests

- Unit tests: safe classification (wrapped context errors, unknown error, typed DB error), route-template normalization, request-ID continuity, correct status on successful/failed/panicked requests, no duplicate reporting.
- Privacy tests: injection of URLs, SQL parameters, task text, cookies, passwords, auth tokens and long/untrusted strings never reaches stdout or a Better Stack event.
- DB integration: induce a deterministic, bounded timeout while holding/contending for a connection; assert the correct stage and classification, without affecting production databases.
- Functional regression: unchanged JSON response/status/auth, idempotency and transaction behavior; `go test -race`, `go vet`, lints, integration tests.
- Failure isolation: observability disabled, exporter full or unreachable must never fail a task request; no synchronous network call on a hot request path.

**Exit gate:** Given a synthetic timeout, a developer can find its request ID and safe operation/stage/classification directly in Render logs, with no unsanitized private text.

## 4. Stage 2 — Centralized logs, correlation and targeted traces (P1)

### 4.1 Log ingestion — select exactly one route

**Preferred first implementation:** retain `slog` structured JSON to Render stdout and choose either (A) a bounded asynchronous Go log sender to a dedicated Better Stack Telemetry source or (B) managed Render log forwarding, **not both**. Prefer provider-native forwarding if the plan/workspace supports service-scoped routing at acceptable cost; otherwise use a small nonblocking Go sender. Validate actual Render and Better Stack plan capabilities and retention/ingest quotas **before** activation.

- Create an API log source separate from the existing Sentry-compatible **Errors** application; do not reuse the Errors DSN for log ingestion.
- Secrets live only in Render config, never in source control, browser assets or Cloudflare public environment variables.
- Avoid logging success payloads, unbounded bursts, and credentials. Start with errors + sampled normal completions + low-frequency DB pool summaries; exclude repetitive healthy scheduled jobs or sample them.
- Set a volume/retention budget and document ownership, query examples and how to turn ingestion off. Storing all high-volume logs indefinitely on a free tier is not assumed to be free.
- Logs are not a substitute for the existing Errors quota; there must be independent rate/volume controls, bounded buffering, no request-blocking retries and explicit dropped-log counters.

Example conceptual query (adjust syntax to the provisioned source schema):

```sql
SELECT dt, raw
FROM {{source}}
WHERE dt >= {{start_time}}
  AND dt < {{end_time}}
  AND JSONExtractString(raw, 'request_id') = '<redacted-request-id>'
ORDER BY dt;
```

### 4.2 Trace rollout — server first, browser optional

Use OpenTelemetry standard propagators and OTLP where the provider supports them; do not build a home-grown tracing protocol.

Initial spans only:

```text
browser or Cloudflare API proxy (optional)
  → Go HTTP server span [route, status, duration]
    → service operation [calendar / report / auth / tasks]
      → pgx pool acquisition / transaction / SQL operation span [safe operation name only]
```

- **Go-first:** instrument the HTTP entry point and selected DB/service operations. Preserve the existing shared `pgxpool` and service-owned transactions; do not replace database access abstractions solely for tracing.
- Propagation: carry validated W3C `traceparent` through the same-origin Cloudflare proxy. Treat incoming trace context as untrusted; reject malformed values and do not allow baggage or arbitrary headers to become log fields. A frontend span is not required to correlate Go and DB spans.
- Add `trace_id` and `span_id` to structured logs only when a valid span is active. Place a trace reference (if supported) in allowlisted Better Stack error context to link Errors → Logs → Traces; **do not** change alert grouping to per-request IDs.
- Span names are low-cardinality route/operation names; attributes must not include URL queries, SQL text/bindings, auth/session values or task content. Disable replay and automatic body/header capture.
- Start with low head-based sampling and an explicit per-day/volume budget; include synthetic error-case verification. Do not assume head sampling can always retain every error trace. Consider error-biased or tail sampling only if evidence and provider support justify additional complexity.
- OTLP export must have short timeouts, bounded queues and a circuit/disabled mode. Failure to export must not delay business requests. Separate sampling costs from the already-capped Sentry-compatible Errors stream.

### 4.3 Alerting, correlation and runbook

- Keep uptime monitor and error tracking distinct: `/readyz` confirms readiness but not why a business query timed out.
- Group incidents by normalized error category + low-cardinality route/operation and release where useful; suppress repeat bursts, rather than paging on each `Reporter.Capture` stack or `request_id`.
- Alert only actionable classes (e.g. sustained DB timeout spike, sustained elevated 5xx rate, confirmed readiness outage); treat occasional client cancellation as diagnostic rather than an incident.
- Define baseline/thresholds from measured traffic; avoid invented fixed numbers at low scale.
- In `deploy/monitoring.md`, add a runbook: start with incident and time window → safe error metadata → correlated request log → trace DB stage → compare Render service events and Neon metrics → record confirmed cause / uncertainty.
- Link a release SHA to code/deploy history. Do not interpret multiple alerts from one burst as separate causes without evidence.

### 4.4 Stage 2 acceptance tests

- Log ingestion: a synthetic sanitized error is visible in the dedicated Better Stack source, linked by a stable `request_id` to the Render event; no duplicate delivery through two pipelines.
- Trace: a sampled `GET /api/v1/reports/period` connects the Go request span to one named DB operation span with correct parentage and error status; exporter-off path retains normal behavior.
- Cloudflare forwarding: valid trace context reaches Go; malformed/untrusted inputs are safely ignored. No credentials/private data appear in recorded attributes.
- Incident workflow: from one synthetic failure, an engineer can navigate alert → error event → request logs → trace in an internal runbook without knowing user data.
- Telemetry interruption, bursts and provider quota exhaustion cause bounded drops, **never** stalled user requests, unbounded memory growth or leaked secrets.

## 5. Delivery sequence, effort and risk

| Slice | Implementation | Relative complexity | Dependencies / rollout |
| --- | --- | --- | --- |
| 1A | HTTP `slog` envelope, request/status/route context, structured failure classification | Low–medium | API-only; no new runtime vendor |
| 1B | `pgxpool` diagnostics and named DB stage timing | Medium | Touches shared transaction/repository paths; test locking and timeouts carefully |
| 1C | Allowlisted Better Stack error enrichment, dedupe/grouping review | Medium | Must pass privacy and daily-quota regression tests |
| 2A | Separate Better Stack log source + single ingestion path | Low–medium | Provision credentials and confirm billing/retention; feature flag |
| 2B | OTel Go HTTP + selected DB spans and correlation | Medium | New Go dependencies/configuration; sample and bound all exports |
| 2C | Optional Cloudflare/browser propagation, alert/runbook tuning | Medium (optional for initial release) | Cross-component deploy coordination; implement only after Go traces are useful |

**Complexity assessment:** Both stages are practical for this small stack and do not require a new backend/database, an ORM, a collector cluster or always-on worker. The *hard parts* are privacy-preserving context, accurate split of connection-wait vs SQL timing, and avoiding telemetry overhead/cost. Do not bundle browser full-fidelity tracing, all SQL statements, dashboards, and alert rewrites into the minimum implementation. Implement as small reviewed commits/PRs, though both phases may be tracked in one plan.

### Rollout / rollback

1. Establish baseline logs and provider limits. Merge Stage 1 with safe stdout only; run unit/integration tests and one synthetic fault.
2. Provision Better Stack log destination with retention/volume budget; enable Stage 2 logging only in a controlled canary. Compare duplicate events, CPU/memory and ingestion volume.
3. Enable sampled Go HTTP + named DB spans, then optionally propagate from Cloudflare. Validate with synthetic trace, not a real user error.
4. Tune grouping and alert policies after observing real low-cardinality error categories.
5. Roll back ingestion/tracing using independent environment flags. Keep safe structured stdout and the preexisting capped Errors reporter. Removing the flags must not require changing database schema or product behavior.

### Out of scope

No raw SQL capture, query parameters, task body logging, PII/replay, comprehensive browser monitoring, full distributed database instrumentation, new permanent Postgres metrics tables, or a new monitoring service. No modifying historical events or resolving existing incidents automatically.

## 6. Definition of done / ownership

**Stage 1 done** when Render shows normalized method/route/status/duration + request ID for a failed request, logs preserve a safe technical cause and DB stage/pool data, and privacy/regression tests pass.

**Stage 2 done** when one protected Better Stack log stream receives bounded sanitized records; a sampled API→named DB trace can be correlated to a request ID and error incident; a runbook documents investigation, cost, disablement and known sampling limitations.

Implementation owners:
- `apps/api/internal/controllers` + `middleware`: request and error boundaries.
- `apps/api/internal/monitoring`: privacy allowlist, bounded sending, existing error-event caps.
- `apps/api/internal/services` + `repository` + `database`: named DB operations and pool metrics without changing transaction semantics.
- `apps/api/cmd/api` and `deploy/`: configuration, exporters, secrets and operational runbooks.
- `deploy/cloudflare` / `apps/web`: *optional* trace propagation after server traces work.

**Review checklist:** security/privacy review; confirm Better Stack plan pricing and source retention; verify no double ingestion; verify Go test/race/integration and unchanged API contracts; smoke test with synthetic values; document independent kill switches and baseline overhead.
