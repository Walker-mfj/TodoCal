# TodoCal free deployment

Next.js static assets run on Cloudflare Workers. A small Worker forwards `/api/*` to Render Free, with PostgreSQL on Neon Free. A Cloudflare scheduled handler invokes bounded API jobs; API catch-up remains active. Cold starts are expected.

## Configuration

Live deployment (2026-10-25):

- App: https://todocal.laiphuc.workers.dev
- API: https://todocal-api.onrender.com
- Render dashboard: https://dashboard.render.com/web/srv-dbf0ekks728c73dmd6ig
- Neon project: `delicate-moon-70365012`, production branch `br-icy-feather-b4u8imu4`.
- Render currently deploys from `codex/free-deployment` automatically. Moving the local branch to `main` does not change the Render dashboard setting.
- `.github/workflows/deployFrontend.yml` deploys the frontend on pushes to `main`, or manual runs on `main`, once the workflow is pushed and the secrets below are configured. Local merges alone do not deploy anything. Manual frontend deployment remains available with `npm run deploy` from `deploy/cloudflare`.

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

## Verification

Run `make typecheck test-web test-go`, `node --test deploy/cloudflare/worker.test.mjs`, the Docker build, and Cloudflare dry run. On this machine the PostgreSQL Compose project is `to-do-list`; use `COMPOSE_PROJECT_NAME=to-do-list make test-e2e` to avoid a port collision. Browser tests use a dedicated test database.

On the live URL verify registration/login, session reload, create/edit task, calendar, timer, logout, cache headers, direct API rejection and cold-start recovery. Use a dedicated test account. Do not import local user data without a specific request. Keep backups outside Git and test restoration into a separate database.

## Scheduled jobs and Web Push

This implementation adds a Cloudflare cron trigger every minute. Its `scheduled` handler calls Render `POST /internal/jobs`; the API settles expired timers, materializes upcoming recurrence, and delivers bounded notification batches. API catch-up remains a fallback. Deployment of this configuration and real Web Push delivery have not been verified by local tests.

Configure the following before deploying the cron-enabled Worker:

- Set a separate random `JOBS_SECRET` of at least 32 characters in **both** Render and Cloudflare Worker secrets. Do not reuse `PROXY_SECRET`. The job endpoint requires this bearer credential plus the configured Origin and JSON content type; it does not accept user sessions as authorization.
- Set `APP_ORIGIN` in Cloudflare to the same exact HTTPS application origin configured in Render. Keep `API_ORIGIN` pointing to the Render API. Missing job configuration makes scheduled runs fail visibly; normal app requests remain independent.
- To enable push, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in Render. Generate a matching P-256 VAPID pair using a trusted Web Push tool; use an operator contact `mailto:` or HTTPS subject. Store the private key only as a provider secret. Omit all three to leave Web Push disabled while timer settlement continues. A partial or invalid configuration fails API startup.
- Deploy additive database migrations/backend first, verify `/readyz`, then publish the frontend/cron Worker. Do not rotate VAPID keys casually: existing browser subscriptions are bound to the old public key and need re-enrollment.

The endpoint uses a 20-second execution budget, excludes concurrent in-process runs, and reports counts without private payloads. Database transactions and unique outbox identities guard repeated runs; external delivery is at least once across a crash. Monitor scheduled-handler failures and API job errors, queue age and expired timers. Free-host cold starts may exceed one minute; this is not an exact-time delivery service. A standalone `cmd/worker` remains available for a persistent process.

For release verification, use a dedicated account and explicitly opt in on two devices. Check closed-tab Focus completion, deadline/start reminders, quiet hours, logout/revocation and one offline device. Confirm clicks navigate without starting a timer. Keep credentials and endpoints out of logs and test reports. No production secrets or live service settings are changed by the implementation PR.

## Embedded notification scheduler (staged rollout)

`NOTIFICATION_SCHEDULER_ENABLED` defaults to `false`. Apply migrations through 000020
before enabling it. With the flag enabled, the API owns one next-deadline timer,
receives coalesced wakes after committed schedule changes, and uses separate
bounded lanes for Focus settlement, Web Push delivery, recurrence horizons and
outbox cleanup. Missing VAPID disables delivery only; Focus still settles.

The scheduler currently assumes **one Go API instance** and no separate
`cmd/worker` process. It is not a cross-process leader-election implementation.
Do not enable it for overlapping API replicas without adding shared ownership
and cross-instance wake delivery. An idle/sleeping Render instance cannot send.

- Normal deadlines and committed edits run immediately; provider retries use
  durable `next_attempt_at`. Query/work failures use exponential backoff with
  jitter (initially 1 second, capped base 60 seconds).
- Focus and horizon lanes rotate through due accounts in stable user-ID order.
  Each lane advances its own cursor before attempting work, including on errors
  or timeouts, so a failing account cannot monopolize selection. Its unfinished
  DB work remains eligible on the next wrap; restarting resets only the cursor.
- Reconciliation reloads deadlines every **15 minutes** as a final safety net.
  It does not scan every account. Recurrence edits invalidate an indexed durable
  per-account horizon deadline; horizon work commits one series per pass and
  reschedules eligible accounts at their next local midnight after the final page.
- Scheduler send cutoffs: Focus/Break/lead 5 minutes, task start 10 minutes,
  deadline 15 minutes. Lead reminders never start sending at/after task start.
  Retries beyond cutoff are canceled. A truly missed wake may be discovered too
  late by reconciliation and intentionally suppressed; Focus state still settles.
- Terminal outbox records are retained for 30 days. Cleanup deletes up to 500
  per transaction and persists the next run/checkpoint; a full batch continues
  after one second. Pending deliveries are never deleted by retention cleanup.

Rollout sequence:

1. Deploy migrations/backend with the flag false; verify tests and readiness.
2. Enable the flag on the single API instance. While enabled, authenticated
   `/internal/jobs` calls return a no-op response, so the existing Cron cannot
   concurrently dispatch. Keep `JOBS_SECRET` until the rollout is verified.
3. Verify real push timing, edits, Focus pause/resume, retries and restart with
   dedicated test accounts. Watch sanitized scheduler error logs and outbox age.
4. In a follow-up release after verification, remove the Cloudflare Cron trigger,
   scheduled handler, jobs route/tests and `JOBS_SECRET`. Removing Cron changes
   Render idle/sleep behavior; verify that product trade-off explicitly.

Before step 4, rollback is setting the flag false and restarting the API; the
existing Cron resumes dispatch under the legacy 24-hour policy. Do not roll back
migrations 000019/000020 while a scheduler-enabled binary is running. This change does
not alter live flags, Cron triggers or secrets.

Run `make test-integration` for the separate `focus_scheduler_test` database as
well as existing integration suites. Never point test URLs at development or
production data.

### Scheduler review follow-up: progress and query cost

Migration 000020 marks schedule changes with a transaction-local dirty flag.
The application publishes only after a dirty transaction commits. Read-only GETs
and planning cursor writes do not wake the coordinator; GETs that materialize
occurrences or settle Focus do. The flag rolls back with the mutation.

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
100k tasks with 100 accounts and 1/5 devices per account, prints EXPLAIN ANALYZE
BUFFERS for the production query and reports warm query latency:

```sh
cd apps/api
SCHEDULER_BENCHMARK_DATABASE_URL='postgres://.../focus_scheduler_bench_test' \
  go test ./internal/services -run '^$' -bench '^BenchmarkNotificationNextDue$' \
  -benchtime=10x -count=1 -v
```

CI runs `bash scripts/benchmarkScheduler.sh` after integration tests and uploads
`scheduler-query-plans` with the EXPLAIN output and timings.

The benchmark and database integration cases have not yet been executed in the
restricted editing environment. Do not treat the two-second deadline-query
budget as validated at 100k tasks until these results are recorded on PostgreSQL.
If that budget is exceeded, evaluate a mutation-maintained deadline table using
these plans before enabling the scheduler at that scale. Reconciliation remains
a 15-minute recovery mechanism, not the notification timing path.
