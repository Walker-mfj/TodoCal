# TodoCal free deployment

Next.js static assets run on Cloudflare Workers. A small Worker forwards `/api/*` to Render Free, with PostgreSQL on Neon Free. The Go API runs the notification scheduler; API planning catch-up remains active. Cold starts are expected.

## Configuration

Deployment endpoints:

- App: https://todocal.digitalhome.workers.dev
- API: https://todocal-api.onrender.com
- Render dashboard: https://dashboard.render.com/web/srv-dbf0ekks728c73dmd6ig
- Neon project: `delicate-moon-70365012`, production branch `br-icy-feather-b4u8imu4`.
- Configure Render to deploy `main`; the dashboard branch setting is independent of the GitHub frontend workflow.
- `.github/workflows/deployFrontend.yml` deploys the frontend on pushes to `main`, or manual runs on `main`, once the workflow is pushed and the secrets below are configured. Local merges alone do not deploy anything. Manual frontend deployment remains available with `npm run deploy` from `deploy/cloudflare`.

## Lightsail transition (not yet cut over)

The frontend now uses `https://todocal.digitalhome.workers.dev` (owner-reported). Treat this as a new browser origin: prior cookies, local drafts, service workers and push permissions are not transferred automatically. Verify the existing Render APP_ORIGIN matches the new origin before testing the current site. Verify the account ID and deployment token still target the correct Worker.

The Worker supports a private API binding but Render remains the default until an operator explicitly switches the runtime setting. See [Workers VPC cutover](cloudflare/vpcCutover.md). No public backend hostname is required and no changes are made to the live infrastructure by this PR.

## Frontend deployment from GitHub

Set these GitHub Actions secrets in the repository (or its `production` environment):

- `CLOUDFLARE_API_TOKEN`: an API token allowed to deploy Workers in account `8cf9e69ea0ad681889782c541601c0d1`. Scope it to that account. Local Wrangler OAuth login does not authenticate GitHub Actions.
- `BETTER_STACK_API_TOKEN`: the existing Telemetry token authorized to upload private source maps for TodoCal. Source maps contain frontend source code; do not upload them as public build artifacts.

The workflow installs locked dependencies, runs frontend/proxy tests, builds and checks types, uploads private source maps, then publishes the Worker. Failed checks or uploads stop publication. Only the publication step receives the Cloudflare token. Existing Worker secrets (`API_ORIGIN`, `PROXY_SECRET`) remain in Cloudflare. Deployments are serialized; in-flight deployments are not cancelled. The final website check reports failures but does not automatically roll back.

To move the backend to the same release branch, change Render's deployment branch to `main` after the intended commits have been pushed there. This is a separate live configuration change; the frontend workflow does not change or wait for Render.

## Frontend/backend compatibility

Render and Cloudflare deployments are independent, not an atomic release. One can succeed while the other fails, and open browser tabs can keep running older frontend code even after a successful deployment.

Use additive releases: deploy backward-compatible API fields/endpoints and database migrations first, confirm the backend is live, then publish frontend code that uses them. Keep the old API behavior until older clients no longer need it. Split breaking changes into separate releases; do not merge a frontend requiring a new API until that API is live. For incompatible releases, coordinate maintenance or introduce versioned endpoints. Automatic frontend deployment alone does not enforce this ordering.

Render and Neon use their Free plans. After inactivity, the first API request can take around a minute while Render wakes up. Local accounts and data have not been imported.

Deploy `render.yaml` from this repository (Free plan, Docker context `apps/api`). The current Neon project is in Ohio; Render uses Ohio to keep API/database traffic nearby. Set `DATABASE_URL` to a direct Neon PostgreSQL 18 TLS connection (`sslmode=require`; remove `channel_binding` because the migration driver lib/pq does not support that parameter), `APP_ORIGIN` to the exact Cloudflare HTTPS origin with no trailing slash, and `PROXY_SECRET` to a random secret of at least 32 characters. Keep secrets in provider settings, never Git/chat.

The startup script applies migrations and starts the API on `0.0.0.0:$PORT`. This is for a single instance. Back up before schema updates. Health probes use `/healthz` to avoid continually waking the database; check `/readyz` during release verification.

In `deploy/cloudflare`, run `npm ci`, `npx wrangler login`, `npm run build`, and `npx wrangler deploy --dry-run`. Confirm the `todocal` worker name is unused or belongs to this app. Create/deploy the Worker using `npm run deploy`; store `API_ORIGIN` (Render HTTPS URL) and the same `PROXY_SECRET` using `wrangler secret put` or dashboard secret settings. Set Render APP_ORIGIN to the resulting workers.dev URL. Until secrets are configured, the frontend shell is available but API returns 503; this is not a completed deployment.

The proxy preserves cookies, Origin, CSRF and idempotency headers, overwrites trusted client IP/token headers, never follows upstream redirects, and marks API responses `no-store`. Render API requests without the edge secret are rejected. Cloudflare supplies CF-Connecting-IP; Go trusts it only through the authenticated edge boundary.

Local Next.js development is unchanged. Only `STATIC_EXPORT=true` enables static output. The toolchain pins a patched undici version via an override; remove it when upstream includes the fix. No toolchain dependencies run in the deployed Worker.

## Cloudflare Worker observability

Worker `todocal` enables persisted Workers Logs at 100% head sampling and automatic Workers Traces at 5% head sampling through `deploy/cloudflare/wrangler.jsonc`. This is separate from Render API `OBSERVABILITY_ENABLED` and Better Stack ingestion. No external telemetry destination, token, or API code change is required.

After the frontend Worker is deployed, check Cloudflare Dashboard > Workers & Pages > todocal > Observability > Logs / Traces. Trigger a harmless API request and inspect its invocation and sampled outbound fetch span to Render; because traces are sampled, repeat requests may be needed. For live debugging, run `npx wrangler tail todocal --format pretty` from `deploy/cloudflare`. Invocation logs and traces are not a complete application-level audit, and sampled traces may omit any particular request. Do not include cookies, Authorization headers, proxy secrets, query parameters, request bodies, or user data in future `console.log` messages.

Workers Logs and Traces use Cloudflare Observability account-level ingestion and retention limits. Cloudflare's unified usage-based pricing begins December 1, 2026; verify available usage and billing limits before raising sampling. Lower `observability.logs.head_sampling_rate` or `observability.traces.head_sampling_rate` if needed. This PR only changes deployment configuration; it does not activate the settings in production until `wrangler deploy` runs.

## Verification

Run `make typecheck test-web test-go`, `node --test deploy/cloudflare/worker.test.mjs`, the Docker build, and Cloudflare dry run. On this machine the PostgreSQL Compose project is `to-do-list`; use `COMPOSE_PROJECT_NAME=to-do-list make test-e2e` to avoid a port collision. Browser tests use a dedicated test database.

On the live URL verify registration/login, session reload, create/edit task, calendar, timer, logout, cache headers, direct API rejection and cold-start recovery. Use a dedicated test account. Do not import local user data without a specific request. Keep backups outside Git and test restoration into a separate database.

## Embedded notification scheduler and Web Push

The Go API starts the notification scheduler automatically. There is no enable
flag, legacy jobs HTTP endpoint, minute sweeper, or standalone worker process.
Apply migrations through 000021 before starting the API (the Render startup
script already migrates before serving).

Configure the following **Render** environment variables for Web Push:

- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` or HTTPS
  contact). Keep private keys in provider settings.
- Keep `DATABASE_URL`, `APP_ORIGIN`, `PROXY_SECRET` and existing session settings.
  Cloudflare still needs `API_ORIGIN` and `PROXY_SECRET` for the API proxy.

Missing VAPID configuration disables delivery only; Focus settlement continues.
The API owns one next-deadline timer with independent bounded lanes for Focus,
Web Push delivery, recurrence horizons and terminal-outbox cleanup. Relevant
committed changes wake the coordinator. Known failures and provider retries use
explicit retry timers; reconciliation every **15 minutes** is only a final backup.
Horizon commits one series and a durable cursor per batch. Historical planning
catch-up remains at the API domain transaction boundary.

The scheduler assumes **one API instance**, without overlapping replicas or any
old standalone worker. It does not implement cross-process leader election.
Timers run only while the API process is running. Removing Cron also removes its
periodic requests to Render: on a sleeping free instance, reminders cannot be
sent until the API wakes. Choose an always-running instance if closed-tab,
idle-time delivery is required.

### Deployment and obsolete configuration

The Cron removal is implemented in PR #35. Keep `triggers.crons: []` in
Wrangler configuration so subsequent deployments continue to remove legacy
triggers. The Cloudflare Worker has no scheduled handler.

| Location | Required configuration | Obsolete configuration |
|---|---|---|
| Render | `DATABASE_URL`, `APP_ORIGIN`, `PROXY_SECRET`, session settings and `VAPID_*` for delivery | `JOBS_SECRET`, `NOTIFICATION_SCHEDULER_ENABLED` |
| Cloudflare | `API_ORIGIN`, `PROXY_SECRET` | `JOBS_SECRET`, Cron-only `APP_ORIGIN` |

Remove obsolete variables only after the API release that starts the scheduler
unconditionally is deployed. Keep Render `APP_ORIGIN`; it is still used by the
API. There should be no separately deployed legacy worker or Cron trigger.
`POST /internal/jobs` is removed and returns 404.

For future releases, verify API startup/readiness and deploy the Worker through
its normal workflow. A merged PR does not prove either platform finished
deployment. Check provider settings separately from repository configuration.

Verify with dedicated test accounts: closed-tab Focus completion, pause/resume,
start/deadline edits, recurring reminders, retry and restart, quiet hours and
subscription revocation. Keep terminal-outbox retention at 30 days; pending
retries are never removed by cleanup. Existing lateness cutoffs remain: Focus,
break and lead 5 minutes, task start 10 minutes, deadline 15 minutes; lead stops
at task start. The Cron cleanup did not change these cutoffs or add database migrations.

Run `make test-integration` for isolated PostgreSQL suites and
`node --test deploy/cloudflare/worker.test.mjs` for the proxy/empty-Cron contract.

### Progress and query-cost verification

See [scheduler architecture](../docs/architecture/notificationScheduler.md) for runtime ownership, timeout decisions and tradeoffs.

Migration 000020 marks schedule changes with a transaction-local dirty flag.
The application publishes only after a dirty transaction commits. Read-only GETs
and planning cursor writes do not wake the coordinator; GETs that materialize
occurrences or settle Focus do. The flag rolls back with the mutation. Migration 000021 narrows task UPDATE
wakes to identity, scheduled date/start, deadline, status and deletion changes.
Title, description, priority, end time and revision-only edits do not change the
candidate schedule or generic push payload and do not publish a wake.

Horizon commits one recurring series (at most eight local dates) with a durable
`after_series` cursor per attempt. Retries/restarts retain completed batches;
mutations reset the cursor under the same account lock. The cycle timestamp is
pinned until its final page, so midnight cannot move the target while paging.
Accounts without eligible recurring task/deadline reminders have a NULL deadline;
preference, timezone and recurrence edits reactivate them when needed. Focus
settlement and on-demand calendar recurrence remain independent of this filter.
A single bounded batch can still time out during database unavailability; it is
retried without repeating previously committed series.

`NextDue` uses an EXISTS device check to avoid multiplying candidates by device
count. Its outbox lookup already has the unique `(subscription_id,event_key)`
index; retries use `notification_pending`. Migration 000020 adds an exact UTC
Focus deadline expression index, a completed-Focus time index and a partial
Task deadline index. These are not a substitute for measuring the global view.

Run the opt-in benchmark against a **dedicated disposable** database ending in
`_scheduler_bench_test` (it truncates users and dependent data). It tests 1k, 10k,
100k tasks with 100/1k/10k accounts and 1/5 devices per account. Each account has
a running Focus session, completed Focus history and a Horizon deadline; cleanup
is also scheduled. It calls the full `NotificationSchedule.Next()` under the
same two-second timeout used by the coordinator, captures its actual SQL for
EXPLAIN ANALYZE BUFFERS, and reports the first call plus mean/max warm latency.
Separate candidate and full-Next measurements help isolate query cost:

```sh
cd apps/api
SCHEDULER_BENCHMARK_DATABASE_URL='postgres://.../focus_scheduler_bench_test' \
  go test ./internal/services -run '^$' -bench '^BenchmarkNotificationSchedule$' \
  -benchtime=10x -count=1 -v
```

CI runs `bash scripts/benchmarkScheduler.sh` after integration tests and uploads
`scheduler-query-plans` with the EXPLAIN output and timings.

The integration suite also exercises one series with 100k historical occurrences
and 100k recurrence exceptions, including a negative deadline offset. Its first
Horizon batch must commit all eight new occurrences and its cursor within two
seconds; a fresh backend must finish the cycle on the next bounded call. This
checks large history, not arbitrary database slowness or lock contention. No
further Horizon architecture change is justified without measurements showing
that a bounded series exceeds the budget.

A PostgreSQL benchmark run shared during review passed at 100k tasks and five
devices per account: candidate mean 450.3 ms / maximum 512.0 ms, full
`NotificationSchedule.Next()` mean 438.9 ms / maximum 462.7 ms (10 iterations).
The shared EXPLAIN excerpt reported 475.0 ms execution time. These are local
benchmark observations, not a Neon Free latency guarantee or a load test.
The excerpt alone does not establish which indexes were used or migration cost.
Retain complete CI `scheduler-query-plans` artifacts for plan comparisons.

A passing deadline benchmark does not establish that the large-single-series
Horizon integration case passed; record that result separately. If measured
latency exceeds the budget, inspect the plans and lock contention before changing
timeouts or adopting a mutation-maintained deadline table. Reconciliation remains
a 15-minute recovery mechanism, not the notification timing path.
