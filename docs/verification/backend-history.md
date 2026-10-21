# Recurrence and daily history milestone

Completed: October 21, 2026. Scope: implementation-plan Task 3.

## Implemented

- Daily, every-N-days (2–365), and weekly recurrence with an optional inclusive end date. Each occurrence has its own task ID and stable series/original-date identity.
- Finite lazy generation for requested calendar ranges and elapsed-day catch-up. Moved/deleted occurrences are not regenerated; stopping a series retains current, historical, and explicitly completed occurrences.
- Calendar ranges of 1–93 days and individual day-plan detail endpoints. Today uses live state; historical entries preserve task titles, times, group labels/colors, and completion state.
- Nullable no-plan/future percentages, equal task weighting, and no rounding an incomplete plan to 100%.
- Immutable finalized snapshots before domain reads/writes, with 31-day transaction batches and a persisted catch-up watermark. The worker and API share the account lock and finalization path.
- A minute-based worker, one-shot mode, and API fallback. Periodic sweeps retain their cursor; blocked accounts have a bounded attempt and are retried after wrap without starving later accounts.

## Verified

- `make test-go` and `make test-integration` with race detection; existing authentication/task checks remain passing.
- Fourteen history/recurrence integration tests cover cadence/inclusive bounds, independent completion, deadline inheritance, persistent exceptions, stop behavior, live progress, carryover/deletion history, delayed generation, time-zone transitions, DST warnings, ownership, group-history retention, concurrent worker/API execution, multi-batch catch-up over 100 days, worker starvation, and interrupted-sweep resumption.
- Local-date tests cover a missing New York spring time, the earlier fall overlap, and a São Paulo midnight gap. Progress tests cover no plan, full completion, and incomplete percentages near 100%.
- `make build-api`, `make build-worker`, `make migrate`, `make worker-once`, and `go vet ./...` pass. The development worker smoke check completed with zero local accounts; integration tests exercise populated accounts.
- OpenAPI parses and internal references resolve.

Initial recurrence/calendar tests failed with missing-route responses. Regression tests then reproduced and verified fixes for midnight DST boundaries, forward-zone plan loss, mismatched read clocks across midnight, and future DST exceptions after a zone change.

## Decisions and review

- Nonexistent recurring wall times are skipped with an `invalid_local_time` calendar warning and do not count as missed plans. Future, unfinalized gap predictions are reevaluated after a time-zone change. Users can add an occurrence at a valid time if preferred.
- A forward time-zone jump finalizes crossed dates using the state accepted at change time under the prior zone. This can shorten a transitional day; it prevents retroactive midnight rules from erasing its plan. Previously finalized dates remain unchanged after backward jumps.
- A fresh reviewer identified an Important worker-starvation bug: restarting a globally timed sweep from the lowest UUID could indefinitely exclude later accounts. A real PostgreSQL lock test reproduced the failure; per-account timeouts and retained sweep progress made it pass. A separate test verifies resumption and retry after wrap. The whole suite passed after the fix.
- The reviewer did not execute integration tests against the shared test database. Author verification is the execution evidence. OpenAPI/docs were checked by the author; no second review was requested.
- Very large account query performance is not load-tested. Batching, fairness, and API fallback are covered; exceptionally large batches may need tuning. The earlier Task 2 alternate-UUID input minor remains deferred.

## Still pending

Next.js Clear Week integration, calendar drag/resize and Undo, optional focus timer, weekly/monthly aggregate reports, and browser acceptance tests are later milestones. Daily detail currently covers plan entries; focus-session detail will be added with the timer/analytics work. The visual prototype remains unchanged and disconnected from the API. No public deployment has occurred.
