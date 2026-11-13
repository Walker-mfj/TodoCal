# Proposal: Go Scheduler to Replace Cloudflare Cron

> **Status:** Proposal only — not implemented. This document records a possible future change. This PR must not modify runtime code, Cloudflare triggers, Render configuration, migrations, or secrets.
>
> **Decision scope:** Replace Cloudflare's per-minute scheduled request with an in-process Go scheduler **only while the Go API is running**. Notification delivery is explicitly best-effort during Render Free sleep/downtime.

## 1. Current behavior (baseline)

The `todocal` Cloudflare Worker declares `triggers.crons: ["* * * * *"]` in `deploy/cloudflare/wrangler.jsonc`. Its `scheduled()` handler calls `POST /internal/jobs` on Render with a dedicated `Authorization: Bearer <JOBS_SECRET>` credential. Go validates the credential, the configured application Origin, and request shape before running jobs.

`apps/api/cmd/api/main.go` currently invokes these jobs sequentially:

1. `workers.Sweeper.Sweep` — settle expired Focus sessions and materialize recurring tasks/reminder horizons for accounts.
2. `services.NotificationWorker.Run(ctx, 100)` — populate due candidates into the persistent `notification_outbox`, then revalidate and attempt Web Push delivery.
3. A query counting overdue running Focus sessions for diagnostic backlog reporting.

The `notification_outbox` is **not** a timer and does **not** replace the reminder-candidate query. It holds per-subscription delivery attempts (`event_key`, `due_at`, `next_attempt_at`, `attempts`, `finished_at`, `outcome`). Delivery revalidates current schedules, subscription/session, quiet hours and retries; it is at-least-once around a crash after provider acceptance. Due candidates are currently limited to a 24-hour lookback.

A separate `apps/api/cmd/worker` exists for one-off or persistent periodic sweeps; ensure it is not accidentally run alongside the proposed embedded scheduler.

### What the change does and does not solve

A minute-based Cron introduces up to approximately one minute of scheduling delay before work begins, plus processing and Web Push delivery delay. Replacing it with Go timers or shorter DB polling can reduce this delay **while the Go process is awake**. It does **not** guarantee real-time OS notifications; push services, browsers and networks introduce additional delay.

Render Free can spin down an idle API. With Cron removed, the scheduled request no longer provides periodic inbound traffic. An in-process Go scheduler stops when the process sleeps and only recovers after an external request wakes it again. This trade-off is acceptable **only** if the product explicitly requires notifications while Go is running, not while Go is asleep.

## 2. Proposed architecture

```text
TodoCal mutations / time advancing
                |
                v
     Neon PostgreSQL (source of truth)
       - Tasks / recurrence / Focus
       - notification_candidates
       - notification_outbox / retries
                ^
                |
      Go process background scheduler
       - startup catch-up
       - Focus settlement + recurrence materialization
       - due-candidate dispatch + retry
                |
                v
       Existing Web Push sender
                |
                v
       FCM / Mozilla / Apple
```

### Scheduler lifecycle

- Start **one scheduler per API process** after PostgreSQL is ready; tie its lifecycle to the server context and terminate cleanly on SIGTERM and shutdown. Never launch it during migration-only commands.
- Use Go standard-library goroutines plus `time.Timer`/`time.Ticker` and `context.Context` for scheduling primitives; Go has no built-in durable job scheduler. Implement job selection, retry, concurrency safety and restart recovery explicitly in TodoCal.
- At startup, reconcile expired Focus sessions and materialize reminder horizons, then dispatch due work and pending outbox retries. Always read persisted DB state; do not depend on timers that survived process restart.
- Keep Focus settlement / recurrence materialization separate from notification delivery; failures in one should not indefinitely starve the other. Bound each pass by context deadlines and batch sizes, retaining existing per-account timeouts and keyset cursor behavior.
- **Candidate design for review:** notification dispatch every ~5 seconds *while Go is active*, plus a periodic Focus/recurrence sweep. The sweep must **not** remain the limiting factor for Focus/Break completion: consider a nearest-Focus-end timer/query or more frequent targeted settlement before dispatch. Without this, Focus completion pushes can still be delayed by the sweep interval.
- A more efficient alternative is to query the nearest `due_at` / retry timestamp and use a `time.Timer`; changes to tasks, preferences, focus, recurrence and subscriptions would need a reliable wake-up signal **plus** periodic reconciliation, otherwise earlier newly scheduled events may be missed. Do not create one long-lived goroutine per reminder.
- Preserve existing `NotificationWorker.Run`, idempotent event keys, locking, provider timeouts, quiet-hour handling, retry/backoff, session/subscription revocation and generic notification payloads. Do not log raw SQL, task content, private push endpoints or credentials.
- Leave HTTP request paths and cookie/CSRF handling unchanged. `PROXY_SECRET` remains necessary for `/api/*` through Cloudflare.

### Correctness and concurrency

- Treat Neon as authoritative. Revalidate schedule and subscription immediately before each push attempt. A rescheduled or deleted Task should not cause delivery of a stale event.
- A Go timer is only an optimization, **not durable state**. Process restarts must re-read overdue candidates and unfinished outbox rows.
- Multiple API instances or a standalone `cmd/worker` can produce duplicate sweeps/delivery pressure. Document a single-process assumption initially; if multi-instance deployments are supported, use explicit cross-process coordination (e.g., PostgreSQL advisory lock for scheduler ownership) and retain existing outbox row locks. Do not claim exactly-once push delivery.
- Ensure cancellation is prompt and avoid an unbounded goroutine or query backlog. Measure DB connections, query rate and CPU overhead from a proposed five-second polling interval (up to 12 scheduler checks/minute while active).
- The existing 24-hour lookback can drop older unsent candidates after long downtime; document this as a product trade-off or design a bounded, explicit catch-up policy before implementation.

### Notification outbox retention and daily cleanup

**Current state:** `services.NotificationWorker` sets `finished_at` and a terminal `outcome` (`sent`, `canceled`, `quiet_hours`, `expired`, or `failed`). Completed records are excluded from delivery by the `finished_at IS NULL` filter, but are not periodically removed. The outbox's `UNIQUE(subscription_id, event_key)` also protects against re-queuing the same event while its record exists. Deleting a subscription can cascade to its outbox rows, but that is **not** a general retention mechanism.

**Proposed cleanup policy (not implemented):**

- **Retention:** Keep terminal outbox records for **30 days after `finished_at`** for diagnostics and deduplication. Confirm this window remains longer than the eligible notification-candidate lookback before changing either policy. Only delete rows with `finished_at IS NOT NULL`; do not delete live retries.
- **Expired pending rows:** Existing send/revalidation logic rejects records whose `due_at` is more than 24 hours old; without further handling, those records can remain unfinished indefinitely. Add a separate, bounded step that marks clearly ineligible pending rows terminal (e.g., `outcome='stale'`, `finished_at=now()`) once they are outside the supported lookback and cannot be retried. Do not reclassify valid pending deliveries solely because `next_attempt_at` is in the future.
- **Execution:** The Go scheduler should invoke cleanup **approximately once per UTC day while the process is running**, using its existing scheduler loop or a dedicated `time.Ticker`/`time.Timer`. A **separate Cloudflare Cron Trigger is not required**. On API startup/wake, perform missed cleanup when due. A plain in-memory 24-hour ticker alone is insufficient if Render frequently restarts; persist a last-successful-cleanup checkpoint or equivalent durable due state, and guard against overlapping runs if multiple instances are enabled.
- **Resource bounds:** Delete in batches of **500–1,000 rows** per DB transaction, limit batches/runtime per pass, and reschedule remaining backlog without blocking notification dispatch. Consider a partial index on `(finished_at, id) WHERE finished_at IS NOT NULL` only when actual query/DB metrics justify it. PostgreSQL may reuse freed space after deletion; file size need not shrink immediately.
- **Privacy and diagnostics:** Emit only safe aggregate metrics such as rows marked stale, rows deleted, duration, and failures; no private endpoints, event keys, subscription IDs, credentials or payload data. Review retention and data minimization requirements before production rollout.

Example **design-only** batch query for the terminal-row retention step:

```sql
WITH expired AS (
    SELECT id
    FROM notification_outbox
    WHERE finished_at IS NOT NULL
      AND finished_at < NOW() - INTERVAL '30 days'
    ORDER BY finished_at, id
    LIMIT 500
)
DELETE FROM notification_outbox AS o
USING expired AS e
WHERE o.id = e.id;
```

Cleanup removes **PostgreSQL delivery records**, not already displayed OS/browser notifications. It must not remove the delivery outbox before retries or deduplication are no longer needed.

## 3. Migration and Cron cleanup — future implementation only

Plan this as a coordinated release; **do not remove Cron in this proposal PR**.

1. Introduce the Go scheduler behind a disabled-by-default feature flag. Test against local and integration PostgreSQL; preserve the current Cron-based path as a rollback mechanism. Do not let both schedulers dispatch simultaneously except in a controlled idempotency test.
2. Measure timing with `due_at`, `dispatch_started_at`, `provider_accepted_at`, plus retry/outbox age. A successful provider response is not proof the OS displayed the notification.
3. Deploy the compatible Go API first, enable its scheduler under an explicit cutover plan, and remove the Cloudflare Cron Trigger via `wrangler.jsonc` and the Worker `scheduled()` handler. Validate no remaining invocation attempts and no unexpected DB spikes.
4. After the new scheduler is verified, remove `POST /internal/jobs`, `ConfigureJobs`, dedicated route/diagnostics/tests and unused `JOBS_SECRET` wiring from `apps/api`, `render.yaml`, Cloudflare/Render secrets, tests and documentation. `JOBS_SECRET` is **not** interchangeable with `PROXY_SECRET` or VAPID keys; do not delete those unrelated credentials.
5. If rollback is required, re-enable the old Cron path only with compatible backend code and secrets; ensure Go dispatch is stopped first. Define an emergency path for delayed reminders.

Do not promise a zero-downtime or no-duplicate cutover without verifying the actual deployment order and overlap behavior. Merge and deploy must be separate actions.

## 4. Acceptance criteria for the implementation PR

| Area | Required checks |
| --- | --- |
| API process lifecycle | Scheduler starts once on API startup, not during migrations; stops on context cancellation and shutdown; resumes from DB after restart |
| Focus / Break | Overdue Focus/Break completion settles without a browser read, including boundaries across midnight; notification latency is measured independently of the sweep interval |
| Recurrence | Upcoming occurrences and early recurring deadlines are materialized, including DST edge cases and account keyset progress |
| Notification correctness | Task reschedule/delete, preference changes, quiet hours, subscription/session revocation, multiple devices and retry/backoff remain correct |
| Outbox retention / cleanup | Terminal records kept for 30 days, expired pending records safely finalized, daily Go cleanup runs on startup if missed, bounded batched deletion, no active retries deleted, tests for idempotency/restarts/multiple instances |
| Safety / duplicate sends | Verify multi-worker overlaps, outbox locking, stable event identities, cancellation after user changes, and privacy-safe logs |
| Load / reliability | Verify five-second DB checks are acceptable for Neon Free; monitor queue age, failed sends and long sweeps; test process crash/restart and a sleeping Render service |
| Deployment | No remaining Cloudflare Cron trigger, Worker scheduled handler, `/internal/jobs` exposure, `JOBS_SECRET` dependency, or stale tests/docs after cutover |
| CI | Go vet, Go lint, unit/integration tests, Worker tests, relevant Playwright E2E and a controlled live Web Push smoke test |

## 5. Alternatives and recommendation

| Approach | Main advantage | Main limitation |
| --- | --- | --- |
| Keep Cloudflare Cron (baseline) | Already deployed and provides periodic external wake-ups | ~1-minute check cadence; continued cron traffic |
| Go scheduler in API (proposed) | Reuses Go + PostgreSQL; no Cloudflare scheduler state; quicker checks while Go is running | Stops during Render Free sleep; adds periodic database load |
| Go scheduler in always-on worker | Minimal cross-platform state; no web request dependency | Requires persistent compute; additional hosting cost |
| Cloudflare Durable Objects Alarms / Workflows | Platform scheduling can trigger without a permanently running Go process | New cross-platform state/reconciliation; if Go still dispatches, Render cold start remains |

**Recommendation:** Document and evaluate the Go in-process scheduler if "notifications while Go is running" is the actual requirement. Prefer measuring current send latency and Focus-specific delays before adopting a fixed five-second interval. If notifications must reach closed browsers while Render is sleeping, do **not** replace Cron with Go alone; select an always-on worker or platform-backed scheduling/dispatch instead.

**This document is a proposal; the existing Cloudflare Cron and `JOBS_SECRET` remain active and unchanged until a separate implementation PR is reviewed and deployed.**
