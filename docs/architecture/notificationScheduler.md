# Embedded notification scheduler

Implemented in [PR #32](https://github.com/Walker-mfj/TodoCal/pull/32); legacy
Cron and standalone worker removed in [PR #35](https://github.com/Walker-mfj/TodoCal/pull/35).
This describes the current implementation, not a rollout proposal.

## Runtime and ownership

`apps/api/cmd/api/main.go` starts the scheduler after database setup and stops it
with the API. There is no enable flag, jobs HTTP endpoint, separate worker
executable or Cloudflare Cron. Cloudflare serves static assets and proxies API
requests. Deployment configuration is in the [runbook](../../deploy/README.md).

The coordinator in `internal/workers/scheduler.go` owns one timer and four
independent lanes, with at most one operation in flight per lane:

| Lane | Work |
|---|---|
| Focus | Settle expired sessions at their logical completion time |
| Dispatch | Discover eligible events and deliver/retry durable outbox entries |
| Horizon | Materialize recurring reminder occurrences with durable per-series progress |
| Cleanup | Remove terminal outbox rows older than 30 days, at most 500 per batch |

The timer is rearmed immediately after handing work to a lane, without waiting
for slow delivery to finish. Completion triggers a new deadline query. Startup
queries persisted work, so a restart does not rely on an old in-memory timer.

Relevant committed mutations wake the coordinator through a coalesced channel.
Database triggers mark a transaction-local schedule-dirty flag; only successful
dirty commits publish a wake. Read-only GETs do not wake it, but GETs that actually
materialize tasks or settle Focus do. Task title/description, priority, end time
and revision-only edits do not change notification scheduling.

Reconciliation is **once per 15 minutes per coordinator**, not a timer per
account. It is a final backup for missed changes. Known failures use explicit
retry timers and must not wait for reconciliation.

## Timeout and retry decisions

| Operation | Budget |
|---|---|
| Full `NotificationSchedule.Next()`, including Focus, Horizon, cleanup and notification candidates | 2 seconds |
| Each Focus, Horizon or cleanup lane invocation | 2 seconds |
| Dispatch lane invocation | 20 seconds |
| Individual push provider request | 5 seconds |

These are cancellation budgets, not promised notification latencies. Database
locks, load and process suspension can delay work. The coordinator runs the
deadline query synchronously: a slow query also delays its next scheduling
decision, even though already-running lanes are independent.

Query and lane failures use exponential backoff from one second, capped at a
60-second base plus up to 25% jitter. Delivery retry dates are persisted in the
outbox. Account cursors advance before an attempt so a failing account does not
always block later accounts; in-memory fairness cursors reset on restart.

Horizon commits one selected series and its `after_series` cursor atomically.
The fixed cycle timestamp prevents midnight from moving the target during paging.
Each series examines bounded date ranges (at most eight local dates), including
early deadlines; the next cycle is due at local midnight. Accounts without
eligible recurring reminders have no Horizon deadline. Relevant preference,
timezone and recurrence changes reactivate or reset their progress.

Completed series stay committed across retries/restarts. A timeout rolls back the
current series and cursor together; an individually slow series can still fail
repeatedly. The large-single-series integration test exercises 100k historical
occurrences and 100k exceptions, but cannot prove progress under arbitrary lock
contention. Increasing the timeout alone would not solve unbounded work.

## Historical planning

The scheduler does not sweep all accounts to finalize past plans.
`services.WithTx()` catches up an account when the user returns, with up to
31 days per transaction and a persisted watermark. Focus settlement and reminder
materialization have separate service paths. An inactive account's historical
snapshots can therefore remain unfinalized until an API operation needs catch-up.

Keep the 100-day catch-up and concurrent API catch-up regressions in
`controllers/planning_test.go` and `controllers/planningWorker_test.go`.
See [planning finalization](../features/07-planning-finalization.md).

## Tradeoffs and measured limits

This design reuses PostgreSQL and the existing API instead of adding a queue
service or scheduling service. Durable outbox records and Horizon cursors preserve
work; timers avoid minute-by-minute polling of all accounts.

It currently assumes **one API instance** and has no distributed leader election.
A sleeping or stopped API cannot run timers or send reminders. Removing Cron also
removes its periodic requests to Render. Device delivery still depends on VAPID,
permission, valid subscriptions and the push provider.

The global candidate view remains the main query-cost concern. Deadline queries
repeat after mutations and lane completion, so single-query timings do not prove
throughput under sustained load. The shared PostgreSQL benchmark at 100k tasks
and five devices/account passed below two seconds: full Next averaged 438.9 ms
and peaked at 462.7 ms over 10 iterations. This supports retaining the current
architecture and budget for now, not a production capacity guarantee.

Use the [benchmark procedure](../../deploy/README.md#progress-and-query-cost-verification)
and complete execution plans before changing indexes or introducing a
mutation-maintained deadline table. Benchmarking an empty database migration
does not measure index build cost or write blocking on a populated production
database. A plan may reasonably choose a sequential scan when many rows qualify.

Lateness policy bounds stale notifications: Focus, break and lead reminders allow
five minutes; task start allows ten; deadline allows fifteen. Lead reminders stop
at task start. Recovery after sleep can settle state while dropping notifications
that are too late. Pending outbox retries are not deleted by terminal cleanup.
