# Proposal: Go Scheduler to Replace Cloudflare Cron

> **Status:** Proposal only — not implemented. This document records a possible future change. This PR must not modify runtime code, Cloudflare triggers, Render configuration, migrations, or secrets.
>
> **Decision scope:** Replace Cloudflare's per-minute scheduled request with an **event-driven, in-process Go scheduler** using one `time.Timer` for the next due event, explicit wake-up on schedule changes, and periodic reconciliation (not database polling every five seconds). It runs **only while the Go API is running**; notification delivery is best-effort during Render Free sleep/downtime.

## 1. Current behavior (baseline)

The `todocal` Cloudflare Worker declares `triggers.crons: ["* * * * *"]` in `deploy/cloudflare/wrangler.jsonc`. Its `scheduled()` handler calls `POST /internal/jobs` on Render with a dedicated `Authorization: Bearer <JOBS_SECRET>` credential. Go validates the credential, the configured application Origin, and request shape before running jobs.

`apps/api/cmd/api/main.go` currently invokes these jobs sequentially:

1. `workers.Sweeper.Sweep` — settle expired Focus sessions and materialize recurring tasks/reminder horizons for accounts.
2. `services.NotificationWorker.Run(ctx, 100)` — populate due candidates into the persistent `notification_outbox`, then revalidate and attempt Web Push delivery.
3. A query counting overdue running Focus sessions for diagnostic backlog reporting.

The `notification_outbox` is **not** a timer and does **not** replace the reminder-candidate query. It holds per-subscription delivery attempts (`event_key`, `due_at`, `next_attempt_at`, `attempts`, `finished_at`, `outcome`). Delivery revalidates current schedules, subscription/session, quiet hours and retries; it is at-least-once around a crash after provider acceptance. Due candidates are currently limited to a 24-hour lookback.

A separate `apps/api/cmd/worker` exists for one-off or persistent periodic sweeps; ensure it is not accidentally run alongside the proposed embedded scheduler.

### What the change does and does not solve

A minute-based Cron introduces up to approximately one minute of scheduling delay before work begins, plus processing and Web Push delivery delay. Replacing it with a **next-due `time.Timer` and event-triggered rescheduling** can reduce scheduler wait time **while the Go process is awake** without repeated five-second database queries. It does **not** guarantee real-time OS notifications; push services, browsers and networks introduce additional delay.

Render Free can spin down an idle API. With Cron removed, the scheduled request no longer provides periodic inbound traffic. An in-process Go scheduler stops when the process sleeps and only recovers after an external request wakes it again. This trade-off is acceptable **only** if the product explicitly requires notifications while Go is running, not while Go is asleep.

## 2. Proposed architecture — event-driven Go Timer

```text
Browser mutation (Task / recurring series / Focus / preferences / subscriptions)
       |
       v
Go service transaction -> PostgreSQL COMMIT
       |                            |
       | successful commit          | persistent source of truth
       v                            v
Scheduler wake signal -------> Re-query NextDue from Neon
                                      |
                                      v
                          Reset ONE Go time.Timer
                          for earliest due event
                                      |
                           Timer fires / new wake
                                      |
                                      v
                       Settle Focus if needed;
                       materialize recurrence;
                       enqueue / dispatch due
                       notifications + retry outbox
                                      |
                                      v
                          Web Push provider
                                      |
                                      v
                        Compute next due timestamp
```

The goal is **no fixed five-second database polling when nothing is happening**. PostgreSQL remains authoritative; the scheduler's in-memory timer is only a wake-up optimization. Focus/Break completion is a scheduling source, not merely a by-product of a 60-second sweep.

### Scheduler lifecycle and next-due calculation

- Start a single scheduler coordinator after PostgreSQL is ready; do not launch it for migration-only commands. Tie its goroutine to the HTTP service context, cancel and wait on SIGTERM/shutdown.
- On startup, subscribe to change signals **before** the initial state read; reconcile overdue Focus sessions, materialize the recurrence horizon, deliver already-due notifications/retries, then query the nearest future deadline. Recompute after each dispatch, error or relevant state change.
- Implement a `NextDue(ctx)` query/service that considers **all relevant sources**, not just outbox entries:
  - Upcoming Task start/lead/deadline candidates from `notification_candidates`, with active subscriptions and preferences, after materializing the necessary recurring horizon. Exclude already-enqueued terminal deliveries where appropriate to avoid immediately rescheduling the same event forever.
  - Running Focus/Break's calculated completion timestamp, so a completion is settled at its deadline before dispatching the corresponding push; respect pause/resume/change events.
  - Unfinished outbox retry timestamps (`next_attempt_at`) and any currently overdue dispatch backlog.
  - Maintenance deadlines for recurrence materialization / horizon extension, reconciliation and daily cleanup; cap very distant waits by the next maintenance deadline.
- `time.Timer` waits for the **earliest** of the next due event and maintenance deadlines. When it fires, query and process due records (in bounded batches), then calculate and set a new timer. Do not keep one goroutine or durable timer per Task.
- Preserve `NotificationWorker.Run` for validation, outbox writes, quiet hours, retries, provider timeouts, subscription/session revocation, stable event identity and private payload handling. `time.Timer` itself does not queue notifications or persist delivery history.
- Recover gracefully from temporary DB errors with bounded backoff and an earlier recovery timer; never spin continuously when no candidate can be successfully processed. Avoid heavy account-wide sweeps on every Task edit.

### Wake-up when a user edits Task or Focus

After a **successful transaction commit**, every mutation that can change notification eligibility or timing must wake the scheduler: Task create/edit/delete/restore/complete/schedule, recurring-series edits/stops/restores, Focus start/pause/resume/extend/complete, notification preferences/timezone changes, device subscription/revocation, and relevant auth/session revocation. The service should not rely only on browser-driven changes; internal job writes must be covered as well.

Single Go instance design: use a **buffered channel of capacity 1**, with a nonblocking send after commit. Multiple changes can coalesce into a single wake-up because the scheduler always re-queries the database; it does not trust event payloads. When a wake arrives, cancel/reset the pending timer and recalculate the next deadline. Avoid sending before commit: otherwise the scheduler can read the old schedule.

Example **illustrative pseudocode only** (not code in this PR):

```go
for {
    dueAt := loadNextDueFromPostgres(ctx) // includes focus, candidates, retries, maintenance
    timer := time.NewTimer(max(0, time.Until(dueAt)))
    select {
    case <-timer.C:
        processDueAndReconcile(ctx)
    case <-scheduleChanged:
        // Re-read database and replace the previously scheduled deadline.
    case <-ctx.Done():
        timer.Stop()
        return
    }
    timer.Stop()
}
```

Use safe timer draining/reset semantics for the Go version used. `dueAt` might not exist: in that case wait for a change signal or a bounded reconciliation deadline, not an unbounded timer. Keep one authoritative scheduler loop to serialize timer state. **Never require a full database query every five seconds.**

### Signal reliability, multi-process and recovery

- A channel is **in-process and not durable**. A crash between DB commit and channel send is recovered on the next process startup; periodic reconciliation also recovers missed signals while a process remains alive. Keep a clear, modest reconciliation interval (e.g. every 15 minutes initially, to be measured), not five-second polling.
- If multiple Go instances can write to the same database, an in-process channel does not wake other processes. Consider PostgreSQL `LISTEN/NOTIFY` using a dedicated connection; issuing `NOTIFY` **inside the data transaction** delivers it only after commit and avoids the commit-then-signal loss window. Listeners must reconnect and re-query after disconnect; `NOTIFY` is not a durable queue. If using an explicit single-instance assumption, document it and enforce ownership.
- Prevent race conditions between reading `NextDue` and registering for change signals: initialize listeners before loading state, retain at least one pending wake-up, and always re-query after wake. The DB remains the source of truth if any signal is coalesced/lost.
- Under multi-instance execution, use explicit cross-process scheduler ownership/locking or a carefully tested concurrent-dispatch strategy; existing outbox row locks and unique keys do not eliminate every cross-process race. Do not promise exactly-once provider delivery.
- Retain bounded reconciliation/catch-up for non-user events: recurrence horizon must advance over time, stale pending items must finish, and Focus sessions must still be settled after long downtime. The 24-hour reminder lookback can cause missed older push events; this is an explicit product constraint to review.

### Scheduling and delivery safety

- A rescheduled or deleted Task must invalidate its old event, even if the old timer is about to fire. Always revalidate against current PostgreSQL state **before sending**. Handle subscription/session revocation and quiet hours in the existing worker.
- Never attach user content, raw SQL, private push endpoints, credentials or unbounded event data to diagnostics. Bound timeouts, processed rows and retry attempts, so a slow provider cannot block all future deadlines.
- Measure `due_at → dispatch_started_at → provider_accepted_at`, current/next scheduled deadline, timer resets, wake-up count, and reconciliation recovery, using safe aggregate logs; provider acceptance does not prove OS notification display.
- Account for Render Free sleeping: no timer survives process shutdown, and Go cannot dispatch while the instance is asleep. On restart, rehydrate pending work from Neon and handle late events per the existing 24-hour cutoff.

### Notification outbox retention and daily cleanup

**Current state:** `services.NotificationWorker` sets `finished_at` and a terminal `outcome` (`sent`, `canceled`, `quiet_hours`, `expired`, or `failed`). Completed records are excluded from delivery by the `finished_at IS NULL` filter, but are not periodically removed. The outbox's `UNIQUE(subscription_id, event_key)` also protects against re-queuing the same event while its record exists. Deleting a subscription can cascade to its outbox rows, but that is **not** a general retention mechanism.

**Proposed cleanup policy (not implemented):**

- **Retention:** Keep terminal outbox records for **30 days after `finished_at`** for diagnostics and deduplication. Confirm this window remains longer than the eligible notification-candidate lookback before changing either policy. Only delete rows with `finished_at IS NOT NULL`; do not delete live retries.
- **Expired pending rows:** Existing send/revalidation logic rejects records whose `due_at` is more than 24 hours old; without further handling, those records can remain unfinished indefinitely. Add a separate, bounded step that marks clearly ineligible pending rows terminal (e.g., `outcome='stale'`, `finished_at=now()`) once they are outside the supported lookback and cannot be retried. Do not reclassify valid pending deliveries solely because `next_attempt_at` is in the future.
- **Execution:** Model cleanup as a **daily maintenance deadline in the same event-driven scheduler**, not as five-second polling or a separate Cloudflare Cron. Store the last successful cleanup timestamp/checkpoint durably in PostgreSQL. Include the next cleanup deadline in `NextDue`, run overdue cleanup at startup/wake, and update the checkpoint only after successful bounded work; use a short continuation timer for any backlog. Guard against overlapping runs if multiple instances are enabled. A separate Cloudflare Cron Trigger is **not** required.
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
| Event-driven scheduling | Verify earliest due selection across task/lead/deadline/recurrence, Focus/Break completion, outbox retries and maintenance; timer reset on every relevant post-commit mutation; signal coalescing, edit races, cancellation, and no idle five-second DB polling |
| Signal resilience | Verify commit-before-signal ordering, dropped signal recovery, startup LISTEN-before-load ordering (if used), reconnection, and cross-process behavior / ownership |
| Load / reliability | Measure NextDue query cost and timer resets on Neon Free; monitor notification queue age, failed sends and long sweeps; test process crash/restart and Render sleep/wake |
| Deployment | No remaining Cloudflare Cron trigger, Worker scheduled handler, `/internal/jobs` exposure, `JOBS_SECRET` dependency, or stale tests/docs after cutover |
| CI | Go vet, Go lint, unit/integration tests, Worker tests, relevant Playwright E2E and a controlled live Web Push smoke test |

## 5. Alternatives and recommendation

| Approach | Main advantage | Main limitation |
| --- | --- | --- |
| Keep Cloudflare Cron (baseline) | Already deployed and provides periodic external wake-ups | ~1-minute check cadence; continued cron traffic |
| Event-driven Go Timer in API (proposed) | Reuses Go + PostgreSQL, wakes on schedule changes and actual deadlines, avoids idle five-second polling | Must instrument all schedule mutations, handle signals/races/recovery; stops during Render Free sleep |
| Go scheduler in always-on worker | Minimal cross-platform state; no web request dependency | Requires persistent compute; additional hosting cost |
| Cloudflare Durable Objects Alarms / Workflows | Platform scheduling can trigger without a permanently running Go process | New cross-platform state/reconciliation; if Go still dispatches, Render cold start remains |

**Recommendation:** Prefer the event-driven `time.Timer` scheduler with wake-up on committed schedule edits and a slower reconciliation safety net if "notifications while Go is running" is the actual requirement. Measure current send latency, Focus-specific delays and `NextDue` query cost before implementation. If notifications must reach closed browsers while Render is sleeping, do **not** replace Cron with Go alone; select an always-on worker or platform-backed scheduling/dispatch instead.

**This document is a proposal; the existing Cloudflare Cron and `JOBS_SECRET` remain active and unchanged until a separate implementation PR is reviewed and deployed.**
