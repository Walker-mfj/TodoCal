# Workers VPC transition

The current deployment remains on Render/Neon until the controlled cutover. The owner has created named tunnel todocal-prod on Lightsail and an HTTP VPC Service todocal-api, ID 01a1eed9-dd8d-75e2-b7b3-617e4480ac78. The binding TODOCAL_API targets http://api:10000 via the tunnel. These are owner-provided settings, not verified by this PR. Both cloudflared and api must share the Compose ingress network; only api joins the internal database network. No public origin hostname or custom domain is needed. Workers VPC is beta; retain the known limitations and review pricing/availability when deploying.

## Preflight

- Confirm tunnel is Healthy, cloudflared >=2025.7.0, actual QUIC transport and outbound UDP 7844. Verify HTTP service host api, port 10000, tunnel resolver and same Cloudflare account as Worker. No published hostname or PostgreSQL VPC binding.
- Current Wrangler pin is 4.152.0; run npm ci, npm test, npm run build and npx --no-install wrangler deploy --dry-run in deploy/cloudflare (build needs frontend dependencies). Verify no schema warnings, the binding is listed, and Cloudflare credentials can bind this service (Connectivity Directory Bind or Admin; verify account scope). If deployment fails due to permission or schema, stop and fix it; do not bypass it by publishing API ports.
- Verify Render APP_ORIGIN and the target API APP_ORIGIN equal https://todocal.digitalhome.workers.dev (no trailing slash). Existing browser sessions, drafts and push subscriptions are tied to the previous origin; users must sign in and re-enable push on the new origin. Old sessions/subscriptions may still exist in the DB; do not blindly delete data or rotate VAPID keys. Review old origin access and notification behavior.
- Keep the existing Worker PROXY_SECRET, API_ORIGIN (Render HTTPS URL), and frontend secrets. The same proxy secret is required on target API. Do not print secrets. Verify actual deployed Worker, account and release. Before merging, confirm API_BACKEND is absent or render. Merge can trigger the existing frontend deployment workflow but must not change backend mode.
- Validate target locally (/healthz and /readyz); test the binding against an isolated non-production service if feasible. If skipping rehearsal at owner request, acknowledge live tunnel-to-API validation remains a cutover gate and downtime may be longer. Never start the scheduler on a stale production copy merely to test networking.

## Runtime switch

API_BACKEND is a Worker runtime secret/setting; it is an operational switch, not sensitive, and intentionally absent from wrangler.jsonc vars. Modes:

| Value | Effect |
| --- | --- |
| unset or render | Public HTTPS API_ORIGIN (old Render) |
| maintenance | Every /api/* request returns 503, Retry-After, no-store; assets still served |
| vpc | TODOCAL_API.fetch to fixed private http://api:10000, preserving path/query, method, body, auth and proxy headers |
| anything else | Fail closed with 503 |

Do not add a fallback to Render when VPC fails; scheduler/data ownership makes it unsafe. HTTP is only inside the private path; browser TLS and tunnel encryption remain. Keep API_ORIGIN unchanged until cleanup.

Set the runtime switch through the authenticated Cloudflare dashboard or, from deploy/cloudflare, run:

```sh
npx --no-install wrangler secret put API_BACKEND
```

Enter the intended value at the prompt. This deploys a Worker version; verify the live response and version, and avoid concurrent deploys. Ensure the existing deployment workflow does not reset the secret on redeploy. Never set vpc just to test if the target production database is empty.

## Cutover order

1. Verify prerequisites, backups and restore instructions; freeze deployments. Coordinate with old frontend origin if reachable; all clients/writers must be fenced. Set maintenance on the live Worker, confirm GET and write methods are blocked (GET can mutate domain state), assets still work.
2. Stop Render and its scheduler, disable auto restart/deploy, fence all Neon app writers, then take final consistent encrypted off-host dump. If no durable source fence, abort. Restore into empty target todocal DB, validate data and migration schema before activating API.
3. Start exactly one target API only after confirming old scheduler is stopped. This is the write/side-effect boundary even without users. Check internal /healthz and /readyz. Keep Worker in maintenance until target is ready.
4. Set API_BACKEND to vpc, verify through actual frontend sign-in and API calls on a dedicated account. Confirm cookie/CSRF, task/Focus, calendar/report and push behavior. Do not set render automatically after a VPC failure. If VPC fails after target writes, return to maintenance and fix target or use rehearsed reverse migration.
5. Reconfigure Better Stack readiness monitoring: old public Render monitor is not a valid target; use an authenticated/non-sensitive Worker readiness route or independent private/synthetic monitor in a separate PR. Do not publish DB/API ports to satisfy monitoring. Retain Render and Neon fenced until the recovery window ends.

Before target scheduler starts, rollback can re-enable Render on unchanged Neon after stopping/fencing target and setting render. After target scheduler starts, freeze/fence, preserve target changes, and recover target or reverse restore into validated Neon before switching back. No blind rollback.

References: [Workers VPC get started](https://developers.cloudflare.com/workers-vpc/get-started/), [VPC service configuration](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/), [Tunnel requirements](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/).
