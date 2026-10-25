# TodoCal free deployment

Next.js static assets run on Cloudflare Workers. A small Worker forwards `/api/*` to Render Free, with PostgreSQL on Neon Free. No separate background worker; API catch-up remains active. Cold starts are expected.

## Configuration

Deploy `render.yaml` from this repository (Free plan, Docker context `apps/api`). The current Neon project is in Ohio; Render uses Ohio to keep API/database traffic nearby. Set `DATABASE_URL` to a direct Neon PostgreSQL 18 TLS connection (`sslmode=require`; remove `channel_binding` because the migration driver lib/pq does not support that parameter), `APP_ORIGIN` to the exact Cloudflare HTTPS origin with no trailing slash, and `PROXY_SECRET` to a random secret of at least 32 characters. Keep secrets in provider settings, never Git/chat.

The startup script applies migrations and starts the API on `0.0.0.0:$PORT`. This is for a single instance. Back up before schema updates. Health probes use `/healthz` to avoid continually waking the database; check `/readyz` during release verification.

In `deploy/cloudflare`, run `npm ci`, `npx wrangler login`, `npm run build`, and `npx wrangler deploy --dry-run`. Confirm the `todocal` worker name is unused or belongs to this app. Create/deploy the Worker using `npm run deploy`; store `API_ORIGIN` (Render HTTPS URL) and the same `PROXY_SECRET` using `wrangler secret put` or dashboard secret settings. Set Render APP_ORIGIN to the resulting workers.dev URL. Until secrets are configured, the frontend shell is available but API returns 503; this is not a completed deployment.

The proxy preserves cookies, Origin, CSRF and idempotency headers, overwrites trusted client IP/token headers, never follows upstream redirects, and marks API responses `no-store`. Render API requests without the edge secret are rejected. Cloudflare supplies CF-Connecting-IP; Go trusts it only through the authenticated edge boundary.

Local Next.js development is unchanged. Only `STATIC_EXPORT=true` enables static output. The toolchain pins a patched undici version via an override; remove it when upstream includes the fix. No toolchain dependencies run in the deployed Worker.

## Verification

Run `make typecheck test-web test-go`, `node --test deploy/cloudflare/worker.test.mjs`, the Docker build, and Cloudflare dry run. On this machine the PostgreSQL Compose project is `to-do-list`; use `COMPOSE_PROJECT_NAME=to-do-list make test-e2e` to avoid a port collision. Browser tests use a dedicated test database.

On the live URL verify registration/login, session reload, create/edit task, calendar, timer, logout, cache headers, direct API rejection and cold-start recovery. Use a dedicated test account. Do not import local user data without a specific request. Keep backups outside Git and test restoration into a separate database.
