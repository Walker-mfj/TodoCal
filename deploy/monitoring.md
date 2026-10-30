# TodoCal monitoring

Better Stack application: https://errors.betterstack.com/team/t622845/applications/2811083/data-ingestion
Errors: https://errors.betterstack.com/team/t622845/errors
Monitors: https://incidents.betterstack.com/team/t622845/monitors

## What is collected

Browser unhandled errors, React error boundaries, Go internal errors and panics. Events contain error types, scrubbed stack frames, service name and build revision. Raw error messages, cookies, request bodies, user identities, breadcrumbs, source locals and headers are removed. Source maps are uploaded privately with owner approval; they contain frontend source code. No general log stream, replay, analytics or tracing is enabled.

## Limits

- All frontend and API events share **1000 send attempts per UTC day**, stored atomically in PostgreSQL. Maximum 31,000 attempts in a 31-day month. This bounds this application's sender, not other apps in the Better Stack account or anyone with its ingest credential.
- Reserve before sending; provider errors never refund the budget. No retries. Database failure drops monitoring events and preserves app functionality.
- Per API process: 10 distinct events/minute, suppress repeated sanitized stacks for 5 minutes, queue at most 16 events. The durable daily budget also applies across restarts/instances.
- Browser: 5 reports/minute, at most 20 per page load, suppress duplicates for 5 minutes. Refreshing resets this local limit but cannot reset the shared daily budget.
- Ingestion: same-origin POST only, no cookies sent, max 32 KiB, at most 20 submissions/minute per API process before parsing. Origin is not authentication; this endpoint can receive spoofed requests. It cannot forward to arbitrary URLs or bypass the outbound daily budget.
- These limits apply to monitoring, not normal task operations. Caps and sampling necessarily discard some errors; grouped counts are sampled, not exact totals.
- Better Stack spike protection is an additional safeguard, not the hard daily cap.

## Uptime and alerts

Website monitor `5131235` checks the frontend for TodoCal. API/database monitor `5131236` checks `/readyz` for `"status":"ready"`. Both run every 1800 seconds, request timeout 120 seconds, incident confirmation 180 seconds, recovery 60 seconds. Email only. A normal schedule is 96 checks/day total before retries/confirmation probes; outage detection may take over 30 minutes. Render cold starts are expected. Checks can wake Render and Neon, consuming some free hours/compute.

Errors integration `469405` sends email incidents for new or reopened errors, scoped to TodoCal; it does not notify on every occurrence.

## Configuration and deploy

`BETTER_STACK_DSN` is a Render secret. Empty or invalid configuration disables error reporting; invalid values emit a sanitized warning. No DSN/provider credential is embedded in browser assets. Render supplies `RENDER_GIT_COMMIT` for API releases.

From `deploy/cloudflare`, `npm run build` builds production assets with `NEXT_PUBLIC_MONITORING_ENABLED=true` and the current Git SHA as `NEXT_PUBLIC_RELEASE`. Source maps and matching bundles are copied to ignored `.local/sourcemaps/<SHA>`; all `.map` files are then removed from the public `apps/web/out` directory.

Set `BETTER_STACK_API_TOKEN` in the process environment (never Git). `npm run upload:sourcemaps` uploads private source maps to the configured Better Stack team/application. `npm run deploy` runs build, upload, then Wrangler deploy in order and stops on failures. Commit frontend changes before deployment so a revision uniquely identifies the release. The token is only needed for build-time upload; never place it in NEXT_PUBLIC_* variables or Cloudflare assets.

To disable collection, remove `BETTER_STACK_DSN` on Render and rebuild frontend with monitoring disabled if needed; pause uptime checks separately. Existing stored errors remain in Better Stack under its retention settings.

## Verification

Run web tests/typecheck, Go race tests with the dedicated test database, static build, and `node --test deploy/cloudflare/worker.test.mjs`. Tests cover duplicate and burst dropping, durable concurrent quota, day rollover, privacy scrubbing, provider rejection without retry, invalid config, malformed/oversized intake, and panic response behavior. Send one synthetic event through the live endpoint and confirm it appears in Better Stack. Never trigger a business error or use real user data for a smoke test.
