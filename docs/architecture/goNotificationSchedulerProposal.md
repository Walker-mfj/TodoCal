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
Task / recurrence / Focus / settings / subscription mutation
    -> shared transaction boundary -> COMMIT -> coalesced wake signal
                                               |
                                               v
                          Coordinator (single Go goroutine)
                            - NextDue from PostgreSQL
                            - one time.Timer
                            - responsive to wake + worker completion
                              |                  |
                    due notification      maintenance deadline
                              |                  |
                              v                  v
                     Dispatcher            Maintenance worker
                   bounded batch/time      Focus settlement,
                   existing outbox         recurrence, daily cleanup
                              |                  |
                          completion / progress signals
                              \__________________/
                                      |
                                      v
                          Coordinator recalculates NextDue
```

**No five-second database polling while idle.** PostgreSQL remains authoritative; the coordinator's single in-memory timer is an optimization only. The coordinator must remain responsive to edits and newly due events **while** slow Web Push delivery or maintenance is in progress. A Focus/Break completion is a deadline source, not an incidental result of the old minute sweep.

### Separation of responsibilities and lifecycle

- **Coordinator:** after database readiness (never on migration-only commands), register wake handlers, run startup recovery and load `NextDue`. Own the sole `time.Timer` and serialize timer resets. Select across timer expiration, coalesced schedule-change signals, dispatcher/maintenance completion, and `ctx.Done()`. It **never calls Web Push synchronously**. A scheduler coalesces repeated notifications while a worker is already busy; one outstanding work signal per worker is enough.
- **Dispatcher:** one independent worker initially, with a bounded context deadline and **small batch**. Existing `NotificationWorker.Run(ctx, 100)` processes up to 100 items **sequentially**, allowing up to 5 seconds for each provider attempt (~500 seconds worst-case before database time), so it must **not** run unbounded on the coordinator goroutine. For the implementation, introduce a safe bounded dispatch pass (e.g. initial cap of 2–3 attempts plus an overall ~15–20 second deadline, adjustable after measuring). Preserve per-attempt timeout, outbox transactions, revalidation and exponential backoff. On completion, send a nonblocking progress/completion signal so the coordinator recalculates. Do not launch duplicate dispatcher goroutines if another pass is already active.
- **Maintenance:** separate bounded work from notification delivery: settle expired Focus/Break sessions, materialize future recurring occurrences, perform daily retention cleanup and limited reconciliation. A slow full-account sweep must not block the coordinator or dispatch progress. Use bounded batches and context deadlines, and reschedule unfinished maintenance.
- **Shutdown:** tie all workers to the API service context, stop accepting jobs, cancel/await bounded workers, then release database resources. Only one scheduler coordinator per API process; multiple-process ownership needs additional design.

### NextDue: per-subscription candidate versus existing outbox

**P1 invariant:** A notification candidate already present in `notification_outbox` must **never** be scheduled again from its original `candidate.due_at` — even when its outbox record is unfinished and waiting for retry. The unique delivery identity is **`(subscription_id, event_key)`**, not just `event_key`, so a completed delivery on device A must not suppress an undelivered event on device B.

| Source | Eligibility | Timestamp used by scheduler |
| --- | --- | --- |
| Candidate with **no matching outbox row** for that device | Valid `notification_candidates` event, active subscription and auth session; `candidate.due_at >= subscription.created_at`; same bounded 24-hour lookback and other applicable enqueue filters; not expired by the proposed per-kind late-delivery policy | `candidate.due_at` (future) or **now** if already due and eligible |
| Outbox row with `finished_at IS NULL` | Pending/retry record, including records needing revalidation or cancellation. Do **not** also schedule its candidate | `next_attempt_at` (or now if already due), subject to a dispatcher-in-flight guard |
| Outbox row with `finished_at IS NOT NULL` | Terminal identity remains deduplicated until retention cleanup; no further scheduling for that device/event | **None** |

`NextDue` must use the same subscription/session and event-eligibility rules as the existing enqueue path in `services.NotificationWorker.Run`, **except** that it considers future due times instead of requiring `candidate.due_at <= now`. In particular: retain `s.revoked_at IS NULL`, `a.revoked_at IS NULL`, the `due_at >= s.created_at` check, and a lower bound equivalent to the existing 24-hour candidate lookback. Use `NOT EXISTS (SELECT 1 FROM notification_outbox o WHERE o.subscription_id=s.id AND o.event_key=c.event_key)` for the unqueued candidate side. Do not accidentally filter out devices newly subscribed before their next eligible event.

`notification_outbox` is **not** populated for every future reminder: `notification_candidates` is a view generated from existing Task/Focus state and materialized recurring occurrences. Therefore querying only `notification_outbox` misses future reminders. A `NextDue` implementation must also consider running Focus/Break calculated end times, outbox retries, and the next recurrence-horizon/maintenance/reconciliation deadlines.

**No busy-spin while dispatching:** when the dispatcher has claimed a due batch or is still busy, the coordinator must not continually arm a zero-duration timer for that same backlog. Track `dispatchInFlight` plus a coalesced `dispatchRequested`/progress signal. Keep monitoring separate Focus and maintenance deadlines, and trigger one new dispatch on worker completion when due backlog remains. On DB/provider error use bounded backoff, not immediate re-arming of the same failing deadline. Preserve scheduled retries using `next_attempt_at` and their normal retry policy.

### Event-driven timer control (illustrative pseudocode)

```text
startup:
  install wake listener before initial state read
  recover overdue Focus/recurrence/dispatch work with bounded workers
  recompute NextDue from PostgreSQL

coordinator:
  select on nextDueTimer, scheduleChanged, dispatcherDone,
            maintenanceDone, shutdown:
    if scheduleChanged:
      recompute earliest due timestamp and reset timer
    if nextDueTimer fires:
      signal dispatcher if notification work is due and !dispatchInFlight
      signal maintenance if needed and !maintenanceInFlight
      do not wait for slow worker calls
    if dispatcherDone or maintenanceDone:
      record progress, release in-flight flag, recompute NextDue
    if shutdown:
      cancel and await bounded workers; stop timer
```

Do not create a goroutine per Task or a new dispatcher per wake. A `time.Timer` itself stores no durable state. When there are no pending events, wait for schedule change or the next reconciliation/cleanup deadline; timer reset/cancel semantics must match the Go version in use. Avoid a missed-wake race between registering the listener and reading `NextDue`.

### Wake-up when a user edits Task or Focus

**Centralize post-commit notification** in a shared application transaction/unit-of-work boundary or a narrowly scoped scheduler-aware domain-event publisher. Do **not** require each HTTP handler to remember its own call to `NotifyScheduleChanged()`. Have service-level mutation paths publish a coalesced signal only **after successful commit**; register all relevant Task create/edit/delete/restore/complete/schedule, series edits/stops/restores, Focus start/pause/resume/extend/complete, notification preferences/timezone, push subscription/revocation and auth/session revocation. Non-browser or background mutations must also wake the coordinator.

For a single process, a buffered channel of capacity 1 with nonblocking send can coalesce repeated changes because `NextDue` always re-reads PostgreSQL. Do not notify before commit, when a query could see stale state. Handle signal-after-commit crash, multiple-process writes and signal loss through startup reload/reconciliation; cross-process `NOTIFY` may be preferable when multiple API processes actually exist. Add tests proving every relevant mutation emits a wake and rollback never emits one.



### Signal reliability, multi-process and recovery

- A channel is **in-process and not durable**. A crash between DB commit and channel send is recovered on process startup; periodic reconciliation also recovers missed signals while a process remains alive. **If reconciliation runs every 15 minutes, a lost wake may delay a newly earlier reminder by up to roughly 15 minutes plus processing time.** Choose and document this bound based on an explicit acceptable-lateness target and measured Neon query costs; 15 minutes is a candidate, not a guaranteed-safe default. Track wake loss/recovery metrics and test a dropped wake with an earlier inserted reminder.
- If multiple Go instances can write to the same database, an in-process channel does not wake other processes. **Defer `LISTEN/NOTIFY` until multi-instance deployment is needed.** If adopted on Neon, the long-lived `LISTEN` session must use a **direct/unpooled Neon connection** (not its PgBouncer transaction-pooler endpoint); merely reserving a connection from a pooled endpoint is insufficient. Publishing `NOTIFY` in the same PostgreSQL write transaction provides post-commit notification semantics. Listeners must reconnect/re-subscribe, re-query after reconnect and reconcile missed signals; `NOTIFY` is not a durable queue. Do not assume direct listeners can remain connected through Neon suspend/restart.
- Prevent race conditions between reading `NextDue` and registering for change signals: initialize listeners before loading state, retain at least one pending wake-up, and always re-query after wake. The DB remains the source of truth if any signal is coalesced/lost.
- Under multi-instance execution, use explicit cross-process scheduler ownership/locking or a carefully tested concurrent-dispatch strategy; existing outbox row locks and unique keys do not eliminate every cross-process race. Do not promise exactly-once provider delivery.
- Retain bounded reconciliation/catch-up for non-user events: recurrence horizon must advance over time, stale pending items must finish, and Focus sessions must still be settled after long downtime. The 24-hour reminder lookback can cause missed older push events; this is an explicit product constraint to review.

### Scheduling and delivery safety

- A rescheduled or deleted Task must invalidate its old event, even if the old timer is about to fire. Always revalidate against current PostgreSQL state **immediately before attempting Web Push**. This reduces stale notifications but **cannot retract** a push already accepted by FCM/APNs/Mozilla, nor eliminate the narrow race between the last validation and provider acceptance. Handle subscription/session revocation and quiet hours in the existing worker.
- Never attach user content, raw SQL, private push endpoints, credentials or unbounded event data to diagnostics. Bound timeouts, processed rows and retry attempts, so a slow provider cannot block all future deadlines.
- Measure `due_at → dispatch_started_at → provider_accepted_at`, current/next scheduled deadline, timer resets, wake-up count, and reconciliation recovery, using safe aggregate logs; provider acceptance does not prove OS notification display.
- **Late-delivery policy by notification type (proposal):** distinguish a maximum acceptable **send lateness** from both the existing 24-hour candidate lookback and the unrelated 30-day outbox retention. A Focus/Break completion that is several hours late should be **suppressed**, not announced upon reopening TodoCal. Define configurable windows by kind (`focus_complete`/`break_complete` shortest; `task_lead`/start/deadline based on product semantics) and establish exact minutes with UX acceptance tests. For example, consider a few minutes for Focus/Break rather than the current blanket 24-hour policy. Apply the same expiration decision consistently to candidate selection, NextDue and deliver/retry validation; mark expired queued records as terminal `canceled` (or an agreed existing terminal outcome), not endlessly retryable. This may require a future code/schema contract change; it is **not implemented** by this PR.
- Account for Render Free sleeping: no timer survives process shutdown, and Go cannot dispatch while the instance is asleep. On restart, rehydrate pending work from Neon, suppress too-late event kinds under the proposed policy and avoid replaying a stale Focus/Break notification.

### Notification outbox retention and daily cleanup

**Current state:** `services.NotificationWorker` sets `finished_at` and a terminal `outcome` (`sent`, `canceled`, `quiet_hours`, `expired`, or `failed`). Completed records are excluded from delivery by the `finished_at IS NULL` filter, but are not periodically removed. The outbox's `UNIQUE(subscription_id, event_key)` also protects against re-queuing the same event while its record exists. Deleting a subscription can cascade to its outbox rows, but that is **not** a general retention mechanism.

**Proposed cleanup policy (not implemented):**

- **Retention:** Keep terminal outbox records for **30 days after `finished_at`** for diagnostics and deduplication. Confirm this window remains longer than the eligible notification-candidate lookback before changing either policy. Only delete rows with `finished_at IS NOT NULL`; do not delete live retries.
- **Expired pending rows (current behavior vs optional optimization):** Existing `NotificationWorker.deliver()` selects due unfinished rows and checks `o.due_at >= now - 24 hours`; when too old, its `valid` condition is false and `finish("canceled")` sets `finished_at` as soon as the worker reaches that row. **There is no missing terminal-state transition in the normal delivery path**, and no new `stale` outcome is needed. An optional **bounded bulk finalization** can help drain a large expired backlog faster when ordinary per-row delivery is too slow; it must use the same eligibility and terminal behavior, and must not delete or cancel valid waiting retries.
- **Execution:** Model cleanup as a **daily maintenance deadline in the same event-driven scheduler**, not as five-second polling or a separate Cloudflare Cron. Store the last successful cleanup timestamp/checkpoint durably in PostgreSQL. Include the next cleanup deadline in `NextDue`, run overdue cleanup at startup/wake, and update the checkpoint only after successful bounded work; use a short continuation timer for any backlog. Guard against overlapping runs if multiple instances are enabled. A separate Cloudflare Cron Trigger is **not** required.
- **Resource bounds:** Delete in batches of **500–1,000 rows** per DB transaction, limit batches/runtime per pass, and reschedule remaining backlog without blocking notification dispatch. Consider a partial index on `(finished_at, id) WHERE finished_at IS NOT NULL` only when actual query/DB metrics justify it. PostgreSQL may reuse freed space after deletion; file size need not shrink immediately.
- **Privacy and diagnostics:** Emit only safe aggregate metrics such as expired pending rows finalized (if bulk optimization is used), rows deleted, duration, and failures; no private endpoints, event keys, subscription IDs, credentials or payload data. Review retention and data minimization requirements before production rollout.

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
| Focus / Break | Overdue Focus/Break completion settles without a browser read, including boundaries across midnight; notification latency is measured independently of sweep; several-hours-late Focus/Break pushes are suppressed per documented per-kind lateness policy |
| Recurrence | Upcoming occurrences and early recurring deadlines are materialized, including DST edge cases and account keyset progress |
| Notification correctness / next due | Separate unqueued candidate `due_at` from unfinished outbox `next_attempt_at`, keyed by `subscription_id + event_key`; preserve subscription creation, lookback, auth and preference filters; test retry waiting at 10:01 after failed 10:00 send, plus two-device delivery independence |
| Dispatcher isolation | Coordinator remains responsive to an earlier new deadline while provider sends are slow; enforce a small batch and overall deadline, only one dispatcher at a time, completion wake and no busy-spin on in-flight backlog |
| Outbox retention / cleanup | Terminal records kept for 30 days; verify existing old-pending `deliver() → canceled` path and optional bulk-finalization equivalence; daily Go cleanup on startup if missed, bounded batched deletion, no active retries deleted |
| Safety / duplicate sends | Verify multi-worker overlaps, outbox locking, stable event identities, cancellation after user changes, no busy-spin and privacy-safe logs; document that a push already accepted by the provider cannot be retracted |
| Event-driven scheduling | Verify earliest due selection across task/lead/deadline/recurrence, Focus/Break completion, outbox retries and maintenance; timer reset on every relevant post-commit mutation; signal coalescing, edit races, cancellation, and no idle five-second DB polling |
| Signal resilience | Shared after-commit wake publisher covers relevant service mutations/rollback; lost-signal reconciliation latency is measured and justified by acceptable lateness; if multi-instance `LISTEN/NOTIFY` is used, require direct/unpooled Neon listener, reconnection and cross-process ownership |
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
