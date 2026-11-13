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

## Cloudflare Worker observability

Worker `todocal` enables persisted Workers Logs at 100% head sampling and automatic Workers Traces at 5% head sampling through `deploy/cloudflare/wrangler.jsonc`. This is separate from Render API `OBSERVABILITY_ENABLED` and Better Stack ingestion. No external telemetry destination, token, or API code change is required.

After the frontend Worker is deployed, check Cloudflare Dashboard > Workers & Pages > todocal > Observability > Logs / Traces. Trigger a harmless API request and inspect its invocation and sampled outbound fetch span to Render; because traces are sampled, repeat requests may be needed. For live debugging, run `npx wrangler tail todocal --format pretty` from `deploy/cloudflare`. Invocation logs and traces are not a complete application-level audit, and sampled traces may omit any particular request. Do not include cookies, Authorization headers, proxy secrets, query parameters, request bodies, or user data in future `console.log` messages.

Workers Logs and Traces use Cloudflare Observability account-level ingestion and retention limits. Cloudflare's unified usage-based pricing begins December 1, 2026; verify available usage and billing limits before raising sampling. Lower `observability.logs.head_sampling_rate` or `observability.traces.head_sampling_rate` if needed. This PR only changes deployment configuration; it does not activate the settings in production until `wrangler deploy` runs.

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
