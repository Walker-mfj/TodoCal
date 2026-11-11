# Observability implementation — Stage 1

Spec: [two-stage proposal](observabilityImprovementPlan.md).

Stage 1 is the first independently deliverable increment. Stage 2 remains a follow-up: use an official OpenTelemetry exporter, separately provision a log source, and validate provider quotas before activation. No production provider configuration changes are included here.

## Architecture and constraints

- Add `internal/diagnostics` for request-scoped, allowlisted diagnostics and pgx tracer callbacks. Never retain SQL, bind arguments, headers, raw paths, user IDs or error messages.
- One outer request observer creates an ID, records completion, and encloses proxy/security rejection paths. Controller observation records the registered route template.
- pgx public acquire/query hooks measure each stage without changing transaction and lock semantics. Report first unexpected DB failure; ignore expected `ErrNoRows`. Query timing includes row consumption, not just server SQL execution.
- Enrich the existing Errors reporter through a typed allowlist. Preserve durable 1000/day quota, bounded queue, rate limiting and stack privacy.
- JSON stdout at startup. `OBSERVABILITY_ENABLED` defaults off; no network log exporter in this increment.

## Tasks and verification

1. Correct proposal: cover early middleware rejections and server-owned sampling.
2. Request boundary/classification: add `diagnostics/request.go`, `http.go`, `errors.go` and tests. Interfaces: `HTTP(next http.Handler) http.Handler`, `SetRoute(ctx, pattern)`, `RecordError(ctx, err)`, `SafeContext(ctx) map[string]string`. Tests first: implicit status, 403/415, panic, unknown route privacy, wrapped context/DB errors, writer interfaces.
3. DB diagnostics: add `diagnostics/postgres.go` and tests. `PGTracer` implements pgx QueryTracer and pgxpool AcquireTracer; `LogPool(ctx, pool, interval)` emits pool deltas. Configure tracer before pool creation. Test stage timing, already-canceled context, no rows, SQL privacy, pool contention integration.
4. Error correlation: `CaptureContext(err, map[string]string)` filters all keys/values; stable route/category enter dedupe, request ID never does. Wire `ReportError` and panic context. Test privacy, correlation, unchanged duplicate suppression and quota.
5. Verify: Go race tests, vet, lint, dedicated DB integration if available. Record blocked checks. Add runbook and flag instructions.

## Review focus

- Early proxy/security rejection has one ID and completion record.
- Unmatched route and user-controlled path/query/header never enter output.
- Aborted/panicked streaming response preserves transport behavior and is marked incomplete.
- Expected no-rows does not mask a later failed query; successful calls do not overwrite first failure.
- Correlation does not defeat dedupe or leak arbitrary context fields.

## Execution record

- Baseline suite: monitoring transport test cannot bind localhost in sandbox; other unit packages pass. DB integration requires a reachable dedicated local PostgreSQL instance.
- Isolated PR API/docs snapshot preserves unrelated E2E edits. Publication uses GitHub connector because shell fetch/network is unavailable.
