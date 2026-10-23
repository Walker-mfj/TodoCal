# Isolated local load acceptance

Run: `make test-load`. Uses a unique disposable PostgreSQL 18.3 container, synthetic accounts and a dedicated API binary/loopback port. It ignores the developer DATABASE_URL, cleans up its own resources, and never resets shared databases.

Dataset: 8 accounts, 17,000 base tasks (10,000 in the largest account), 160 recurrence series generating 4,960 occurrences, 365 days/account, 2,920 daily snapshots, 29,200 plan entries, 29,200 task events and 29,200 historical focus sessions/intervals.

Measured 2,400 mixed requests using 12 concurrent workers. Gates: zero unexpected errors, p95 <= 1,000 ms and max <= 3,000 ms per operation. Additional correctness gates: complete large-account pagination, deterministic monthly report reconciliation, one active session from 16 concurrent starts, one task from 8 idempotent duplicate creates, 480 committed distinct writes, exact recurrence count and cross-account isolation.

Environment: Apple M5, 10 host CPUs, 24 GiB host RAM; OrbStack 10 CPUs/~12 GiB RAM; Go 1.26.5; PostgreSQL 18.3. The raw measured results and timestamp are in `load-results.json`.

| Operation | Requests | p50 ms | p95 ms | Max ms | Unexpected errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| cold_calendar | 8 | 183.5 | 256.28 | 256.28 | 0 |
| focus_contention | 16 | 51.91 | 96.65 | 96.65 | 0 |
| idempotency_contention | 8 | 28.4 | 49.98 | 49.98 | 0 |
| month_report | 480 | 178.72 | 361.25 | 529.1 | 0 |
| task_create | 480 | 27.26 | 181.01 | 404.9 | 0 |
| task_list | 480 | 30.97 | 206.27 | 400.2 | 0 |
| task_search_miss | 480 | 24.79 | 165.07 | 231.74 | 0 |
| warm_calendar | 480 | 221.61 | 398.3 | 578.1 | 0 |

Mixed workload: 30.19 seconds, 79.51 requests/second. Correctness and latency gates passed.

This measures the stated local workload, including per-account lock contention. It does not imply a production SLA, unbounded capacity, network latency, a day-long soak, or authentication burst capacity (fixtures use synthetic sessions). Historical data is pre-finalized; catch-up correctness/fairness has separate PostgreSQL integration tests.
