# Lightsail migration plan

Status: **Proposal — documentation only.** No production changes are authorized by merging this document. The current [deployment runbook](../../deploy/README.md) remains authoritative until cutover is complete.

## 1. Goal and scope

Replace Render Free and Neon Free with a single always-running AWS Lightsail instance running the existing Go API, its embedded notification scheduler and PostgreSQL. Keep the Cloudflare Worker, static Next.js frontend, same-origin API paths (new frontend origin as specified below) and Better Stack integration. Remove cold starts and support closed-tab reminders without adding a separate scheduler, queue, Kubernetes, Redis or managed database.

Baseline: main at 9a668e32a238cb097a8b10ae2db439b29a8cd67d. The API currently uses Render Ohio, Neon Ohio PostgreSQL 18, an embedded scheduler and migrations through 000021 according to the deployment runbook. Reconfirm the actual deployed SHA, schema version and provider settings before migration; repository configuration is not proof of deployed state.

## 2. Target architecture and design decisions

```text
Browser (todocal.digitalhome.workers.dev)
  -> Cloudflare Worker (static FE, /api/* proxy, no Cron)
     -> Workers VPC Service (TODOCAL_API, private HTTP api:10000)
        -> cloudflared (outbound connection)
           -> Go API:10000 + embedded scheduler
              -> PostgreSQL 18:5432
                 -> persistent named volume
Lightsail (Tokyo): cloudflared, API and PostgreSQL managed by Compose
PostgreSQL logical backups -> private off-instance object storage (S3)
API / host / backup / readiness -> Better Stack and AWS metrics
```

- Start with Ubuntu 24.04 LTS, Linux x86-64, Tokyo (ap-northeast-1), 2 vCPU, 2 GB RAM, 60 GB SSD. The public IPv4 bundle is listed at USD 12/month; 4 GB / 80 GB at USD 24/month. Confirm regional checkout price, taxes, credits, transfer allowance and backup costs before purchase. Tokyo is a proposed choice, not a measured latency result. Benchmark representative traffic; resize to 4 GB if memory or CPU burst headroom is insufficient. No HA: instance or AZ failure affects both API and DB. No SLA or zero-downtime claim.
- Use Docker Compose with pinned image versions/digests, restart policies, health checks and persistent PostgreSQL volume. Keep API and DB on an isolated DB network; cloudflared and API share a separate ingress network. API needs outbound push/telemetry access. No host port mapping for API or DB.
- Owner selected Workers VPC Service instead of a published Tunnel hostname because there is no owned DNS zone. Frontend is now https://todocal.digitalhome.workers.dev (owner-reported). The HTTP service todocal-api uses named tunnel todocal-prod, host api, port 10000 and tunnel DNS resolver; Service ID 01a1eed9-dd8d-75e2-b7b3-617e4480ac78. No public API hostname or new domain. Workers VPC is beta; owner accepts dependency and must verify availability/pricing, same-account binding permissions, actual tunnel QUIC transport (outbound UDP 7844, cloudflared >=2025.7.0) and Docker DNS at cutover.
- Preserve PROXY_SECRET verification, trusted client IP and no-store API responses. Render API_ORIGIN remains its HTTPS URL. Private routing uses TODOCAL_API.fetch to fixed http://api:10000 via VPC Service; the Tunnel is encrypted and the local Docker hop is HTTP. Do not expose API/DB ports or publish a hostname. No fallback from VPC to Render. See [PR #40](https://github.com/Walker-mfj/TodoCal/pull/40) for API_BACKEND modes render (default), maintenance and vpc, regression tests and cutover instructions.
- Keep same-origin cookies, CSRF, idempotency, request body, redirect policy and existing VAPID keypair/subject. The frontend hostname changed from todocal.laiphuc.workers.dev to todocal.digitalhome.workers.dev; verify Render/target APP_ORIGIN, deployment account and monitoring. Previous-origin cookies, local drafts, service workers and push permissions do not migrate automatically; sign-in and push re-enablement are required. Review old origin access and fence all writers; do not blindly delete sessions or subscriptions.

## 3. Proposed implementation PRs

These are reviewable stages, not changes included in this proposal.

| PR | Scope | Completion gate |
| --- | --- | --- |
| A | Production Compose, environment contract, deployment/host scripts, health checks and release metadata | Reproduce on disposable host and DB; reboot and recreate API without data loss |
| B | Backup/restore scripts, S3 policy, monitoring and recovery instructions | Verified off-host backup and independent restore; failure alerts work |
| C | API delivery workflow, GHCR, controlled migration and release rollback; proxy maintenance gate and VPC Service binding (PR #40) | CI, staging deploy, serialized releases and rollback drill pass |
| D | Production cutover runbook execution (approved manual operation, not a merge-triggered migration) | All preflight and acceptance checks pass |
| E | Remove or simplify legacy cold-start and scale-to-zero workarounds (separate post-cutover application PR) | Stable baseline, outage and scheduler regressions pass |
| F | Post-soak cleanup and update canonical docs | Recovery window closed with owner approval |

Possible paths (follow repository camelCase conventions for custom filenames):

```text
deploy/lightsail/
  compose.yaml
  .env.example
  setup.sh
  deploy.sh
  backup.sh
  restore.sh
  README.md
.github/workflows/deployBackend.yml
```

Reuse apps/api/Dockerfile and existing Go entrypoint where possible; local development and existing frontend deployment stay unchanged. Never apply the production Compose project from local/test tooling. Add automated proxy/maintenance and configuration tests in the implementation PRs.

## 4. Phase A — provision and configure

### AWS and host

- [ ] Confirm AWS account, actual credits/expiration, region and cost. Configure cost alerts (e.g. USD 20 and 30; alerts are not spending caps). Create instance, tag owner/application, record instance and backup IDs; attach static IP if needed for administration. Do not expose API to the public IP.
- [ ] Create non-root admin, SSH keys, restrict TCP 22 to operator IP (or separately approved remote-management method); verify access before closing defaults. Disable password/root SSH, enable security updates with controlled restart windows. Check both IPv4/IPv6 firewall rules.
- [ ] Install Docker Engine + Compose plugin from trusted distribution; enable Docker at boot; configure bounded logs (e.g. 10 MB x 3 per container), host time sync, disk and memory alerts. Docker group is effectively root; minimize membership.
- [ ] Set up root-owned production directory (e.g. /opt/todocal), stable Compose project name, runtime env files mode 0600, umask 077; ensure restart/reboot restores services. Secrets must not appear in Git, CI artifacts, commands recorded in history or application logs.
- [ ] Enable daily Lightsail automatic snapshots (latest seven). Test recovery onto an isolated instance with API stopped and no public tunnel; snapshots are not a substitute for logical backups.
- [ ] No public inbound TCP 80/443/10000/5432 for the Tunnel design. Permit outbound DNS, time sync, image pulls, updates, HTTPS push/telemetry/S3 and Cloudflare Tunnel TCP/UDP 7844 as required.

### Compose and API

| Service | Configuration |
| --- | --- |
| postgres | Official PostgreSQL 18 image, pin tested minor/digest. Named volume mounted at /var/lib/postgresql (PG18 image layout, not the PG17 /var/lib/postgresql/data mount). Readiness via pg_isready plus authenticated query. |
| api | Existing image from apps/api/Dockerfile, PORT=10000, APP_ORIGIN=https://todocal.digitalhome.workers.dev, COOKIE_SECURE=true. start.sh sets API_ADDR=0.0.0.0:10000 and applies migrations before starting. |
| cloudflared | Pinned image, remotely managed named tunnel, token scoped to this tunnel, VPC target api:10000 via Docker DNS and QUIC. No host ports. |

Use restart: unless-stopped for normal operation and a graceful stop period (initially 40 seconds for API; test). Do not start API automatically against a freshly restored production copy until explicitly authorized; a stopped old API must not restart on host reboot/deploy. Keep DB volume outside release lifecycle; forbid compose down -v, volume pruning and destructive reset scripts in production. Confirm data directory and persistence across container deletion/recreation. Set reasonable pool/connection limits and conservative PostgreSQL memory settings after observing actual workload; avoid hard OOM-prone caps. Keep free disk for WAL, dumps, image pulls and restores (initial warning 70%, critical 85%). Build images in CI rather than on the 2 GB server.

Current start.sh runs todocal-api -migrate then exec todocal-api. For controlled restores and migrations, override entrypoint for one-shot migration/validation and run the scheduler-bearing process only after explicit approval. Do not mix API releases during migration. Verify migration bookkeeping, trigger functions and role permissions; the application's migration path must have the required DDL permissions, while runtime should not be a PostgreSQL superuser. Prefer a distinct admin/bootstrap role and dedicated migration/object owner; if the existing entrypoint needs the same role for runtime/DDL, use a dedicated non-superuser owner for the first release and document the limitation rather than pretending migration and runtime are isolated.

### Configuration matrix

| Location | Required / action |
| --- | --- |
| Lightsail API | DATABASE_URL (internal host postgres; fresh role/password), APP_ORIGIN (https://todocal.digitalhome.workers.dev, without trailing slash), PROXY_SECRET (same >=32-char secret as Worker), PORT=10000, COOKIE_SECURE=true, VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT (preserve existing), current enabled monitoring env |
| Lightsail DB | Dedicated admin and app/migration roles, strong independent credentials; database todocal (verify actual production name); local-only network, explicit auth rules |
| Cloudflare Worker | Keep HTTPS API_ORIGIN for Render until cleanup; TODOCAL_API binding for private VPC. API_BACKEND unset/render until freeze, maintenance during transfer, vpc only after target readiness. Preserve PROXY_SECRET, frontend build and empty triggers.crons. |
| cloudflared | Tunnel token (server only), rotate if leaked; named tunnel and VPC service in Cloudflare dashboard; QUIC |
| GitHub Actions | Existing CLOUDFLARE_API_TOKEN, BETTER_STACK_API_TOKEN unchanged; scoped backend deployment credentials; GHCR package read credential for instance if private |
| Monitoring | Preserve BETTER_STACK_DSN and any currently enabled OBSERVABILITY_* export configuration. Inventory actual env variable names without values. Existing Go main reads RENDER_GIT_COMMIT for logging/error release; inject actual build SHA compatibly initially or add provider-neutral release env with backward-compatible fallback. |
| Backup | Scoped object-store upload credential, separate restore/read credential; bucket/prefix, encryption and lifecycle configuration |

No JOBS_SECRET, NOTIFICATION_SCHEDULER_ENABLED, legacy minute Cron, /internal/jobs or separate worker. Current code always starts one embedded scheduler; VAPID removal disables push delivery only, not other mutating lanes. Do not copy unused Render-specific env blindly. Encode passwords safely in connection URLs. Internal postgres connection may use sslmode=disable only within the isolated single-host network; Neon direct connections require TLS.

## 5. Phase B — data inventory, backup and rehearsal

Owner requested a direct production migration without a full rehearsal. Rehearsal steps below remain the recommended safeguards; any skipped step must be recorded before the freeze, downtime/restore risk explicitly accepted, and final backup, source fencing, restore validation and rollback gates must still pass. Do not reuse a stale production copy for live testing.

- [ ] Record deployed Render image/commit, migration versions and whether dirty, source server version, database name/size, extensions/versions, schema ownership, grants, roles/default grants, encoding/collation/timezone, row counts and sequence state. Identify all writers including scheduled jobs, admin scripts and independent clients. Check retention and legal/data residency requirements before moving Ohio to Tokyo.
- [ ] Confirm free disk, transfer estimate and PostgreSQL 18 pg_dump/pg_restore versions. Check extension availability on self-hosted image and collation differences; install compatible packages before restore. Do not restore Neon managed roles or provider-only schemas blindly. Review dump TOC; explicitly account for any exclusions and migration history.
- [ ] Take a rehearsal logical dump via Neon **direct** (non-pooler) TLS connection. Use pgpass/PGSERVICE or protected env, not literal credentials in CLI/history. Retain encrypted dump, checksum and sizes outside host; test restoration. Example (placeholders; admin-reviewed commands, not an executable production script):

```sh
umask 077
# PGSERVICEFILE and PGPASSFILE are protected and populated out of band.
# neon-direct must use TLS, and no pooler endpoint.
pg_dump --dbname='service=neon-direct' --format=custom \
  --no-owner --no-acl --file=todocal.dump
sha256sum todocal.dump > todocal.dump.sha256
pg_restore --list todocal.dump > todocal.dump.toc
sha256sum -c todocal.dump.sha256
# Target database pre-created empty by admin, extensions/roles prepared;
# app role is not a superuser. Restore with correct ownership/grants.
docker compose exec -T postgres pg_restore --username=todocal \
  --dbname=todocal --no-owner --no-acl --exit-on-error \
  --single-transaction < todocal.dump
```

Inject authentication securely for the restore client. Verify exit codes; never pipe a failed dump straight into production, never use --clean against a live DB. Single-transaction restore is the conservative starting point, not parallel; measure locks/duration and choose an alternative only in a rehearsal. Reapply intended grants because --no-acl omits them. Validate tables, counts (including stable source manifest during final freeze), constraints, indexes, triggers, sequences, migration versions, representative aggregates and integrity. Run ANALYZE if needed. Record duration of dump, transfer, restore and validation, and set realistic maintenance window plus abort deadline.

- [ ] Start rehearsal API only against disposable data with a dedicated test origin and test credentials. Use isolated synthetic accounts/devices or scrub copied push endpoints, sessions, notifications and private user data **before** starting; also deny production push/telemetry egress and omit production credentials. Preserve an unmodified restored copy for integrity verification without running API. Never send production users test notifications; setting VAPID empty does not prevent Focus/Horizon writes. Verify DB readiness, migration behavior, persistence, backup and recovery after reboot; exercise scheduler restart/catch-up and test-only device. Destroy rehearsal copies securely when no longer needed.
- [ ] Run make typecheck test-web test-go, make test-integration, CI E2E and proxy tests, Docker build and Wrangler dry run using isolated test databases. Never run scheduler benchmark/truncation scripts against production. Measure full scheduler Next() relative to existing 2s budget, pool usage, disk growth, peak memory, and API/readiness latency on target. Use sanitized artifacts only.

## 6. Phase C — release automation and operational readiness

Build in GitHub Actions on approved main commits after required CI succeeds; push immutable SHA and record image digest under GHCR. Separate build/publish (contents:read, packages:write) from protected production deployment. The server needs only read-package permission. Use a reviewed SSH deployment path compatible with restricted ingress: preferably operator-triggered deploy/pull over key-based SSH initially; if automating, use a dedicated trusted runner/connector with known network reachability and protected environment approval. Do not open SSH to all GitHub-hosted runner IPs or assume default runner reaches the host. Pin SSH host key; scope deploy privileges carefully (Docker access is root-equivalent), serialize deployments via workflow concurrency and a host lock.

Release script: validate configuration and target SHA/digest, pull candidate, take verified pre-migration off-instance backup if schema changes, stop old API and wait for its process to exit, apply migrations once, start new API and check /healthz (process) and /readyz (DB) with timeout, run smoke tests and record status. Keep DB and Tunnel running. No rolling overlap because scheduler has no cross-process leader election. No automatic rollback that ignores schema compatibility. For an incompatible migration, maintain a write freeze and use rehearsed data recovery/forward fix. API rollback after compatible schema change can select previous digest; DB rollback requires separate explicit data-loss review. Preserve previous digest and configuration in a release journal; do not expire it before rollback window closes.

Frontend deployment currently triggers on every push to main and is independent. Coordinate backend-first additive releases; freeze deploys during cutover, do not assume frontend workflow waits for backend. Implementation must preserve this contract or intentionally add ordering. After migration, docs should state how to deploy and revert each independently.

### Backup

- [ ] PostgreSQL logical backup every 6 hours, retain 7 days; daily backup retain 30 days. Use systemd timer or equivalent host timer (not Cloudflare Cron), non-overlapping lock, temporary files with restricted mode, checksums, upload verification and expiry via separate bucket prefixes/lifecycle. Set size and freshness alarms; disk space failure must be visible. Preserve a pre-cutover and pre-schema-change backup separately until explicitly released.
- [ ] Private S3 bucket with Block Public Access, encryption at rest/TLS and versioning if appropriate. Use least privilege (write to backup prefix; separate read for restore, no broad deletion for backup writer). Establish actual credential delivery supported by Lightsail; do not assume EC2 instance profiles on Lightsail. If using a dedicated IAM access key, store protected, limit prefix/actions and plan rotation; owner approves. S3 and snapshots billed separately.
- [ ] Run independent restore monthly and before cutover. Record checksum, row/constraint verification, readiness (isolated), elapsed time, backup age and operator. Restore on replacement host with production scheduler and tunnel disabled until failover is authorized; recover configuration and credentials from separately secured store. Document how to replace tunnel/route, how to revoke old credentials and how to avoid a second active scheduler.
- [ ] Proposed steady-state RPO <=6 hours only while verified backups succeed; RTO target <=2 hours to be validated by drill. This is logical dump recovery, not point-in-time recovery; use WAL archiving/PITR or a managed HA DB if requirements tighten.

### Observability gates

Keep existing Better Stack errors, logs/traces when enabled and Cloudflare observability sampling/quotas; no sensitive request data. Update existing API readiness monitor (currently direct Render /readyz) to a safe Worker readiness route or private/synthetic monitor in a separate implementation step. The current Worker only proxies /api/*; /readyz and /healthz are not proxied, and the private service has no public hostname. During cutover check internal endpoints and a dedicated same-origin smoke. Never expose backend ports for monitoring. Monitor frontend separately; exercise true same-origin API smoke on dedicated account. Monitor CPU burst capacity, RAM, disk, Postgres errors/connections, scheduler timeout/retry/backlog, backup freshness, container restarts, API 5xx/latency and Tunnel availability. Establish alert channel and test failure/recovery; shorten current 30-minute readiness monitor interval where plan allows. Record baseline and usage limits; avoid raising exporter sampling without checking quota.

## 7. Phase D — production cutover checklist

Owner approves downtime, region/cost and rollback criteria after rehearsal. Use the same application release on both sides (migration only, no simultaneous feature/schema change). Record UTC/JST times and command outcomes without secrets. The old source remains authoritative until final freeze. No live dual-write or automatic replication is proposed.

1. [ ] Schedule maintenance outside important reminders. Confirm latest successful backup and measured downtime, credentials, release digest, current schema, VPC binding/tunnel, operator access, readiness monitor, and rollback access. Freeze both frontend and backend auto-deploys; pin maintenance Worker version. Verify no external writer remains.
2. [ ] Set API_BACKEND=maintenance using the tested Worker maintenance gate for **all** /api/* methods, including GET, with 503, Retry-After and no-store; assets remain available. Verify from browser and direct request. GETs can mutate planning, recurring tasks or Focus, so denying only POST/PATCH/etc is unsafe. No traffic must reach old API while copying. Keep API_ORIGIN on old Render origin throughout cutover; freeze old frontend access too if reachable.
3. [ ] Disable/suspend Render auto-deploy/restart path and stop the old API (including embedded scheduler). Wait for drain/termination; verify process is stopped in Render and no app DB connections or other writers remain on Neon. Fence old credentials/network access as appropriate without losing admin backup access; connection/session termination alone is not durable fencing. Verify no Cron/legacy worker. If unable to establish a durable writer fence, abort cutover.
4. [ ] Capture final source manifest and logical dump after all writers stop; verify checksum/TOC and upload encrypted copy off-instance. Record authoritative source cutover time. Do not use the earlier rehearsal dump for final transfer.
5. [ ] Restore to empty Lightsail production DB, API kept stopped. Validate all rows/critical aggregates, sequences, extensions, migration history/permissions, constraints and application version. Run migration-only check only for identical released version and review any unexpected changes. Final backup/validation gate is zero unexplained discrepancies. If any step fails, keep maintenance on and use pre-activation rollback below.
6. [ ] Confirm old scheduler remains off. Record approval to activate target. Keep API_BACKEND=maintenance; verify the VPC binding, QUIC and relevant Worker version/secrets and no-store gate. Start exactly one Lightsail API. **This is the write/side-effect boundary:** scheduler starts immediately even before public traffic; treat target as authoritative once started even if no browser request has succeeded. No automatic failback after this point. Check internal /healthz, /readyz, proxy-secret rejection for /api/* from the host network, and release SHA; externally validate the VPC route when opening traffic. Do not use mutating/side-effecting production smoke without accounting for it.
7. [ ] Set API_BACKEND=vpc only after readiness, VPC configuration, data and scheduler verification. Confirm actual browser calls go to new origin. Use test account on existing FE origin to check registration/login/refresh/logout, cookies/CSRF, task CRUD/Undo, recurring tasks, focus pause/resume/end, calendar/reports and notifications. Verify existing account session continuity (owner-controlled test), device subscription persistence, quiet hours and closed-tab push. Never replay real old notifications to test. Check outbox/retry/cursors, scheduler health and logs during/after downtime; existing lateness cutoffs (see scheduler doc) may intentionally skip overdue reminders. Delivery is at-least-once around provider send/commit failure; assess duplicate/missed sends, do not promise zero duplicates.
8. [ ] Update Better Stack readiness monitor; take target baseline logical backup and verify off-host. Unfreeze release pipelines only after cutover sign-off and update production environment mapping. Keep Render stopped/fenced and Neon preserved; do not delete either during observation.

### Rollback decision

Before step 6 scheduler activation (no target application writes or deliveries): keep maintenance active, stop/fence any target API, keep maintenance active until Render is ready; then set API_BACKEND=render, restore old credentials if fenced, start only old Render API on unchanged authoritative Neon, verify readiness and remove maintenance by setting render. Capture reason and discard/rebuild target copy only after backup. If any target process may have performed a write or external side effect, use post-activation path.

After target activation: freeze all API methods, stop/fence target scheduler and all writers, capture a new target dump and manifest, preserve both source/target backups. Prefer fixing target in place. For failback, rehearse reverse transfer into a **new empty Neon DB/branch**, check target schema/extensions compatibility and capacity, restore with proper ownership/grants, validate data, update Render DATABASE_URL to restored authoritative data; keep Lightsail fenced. Explicitly approve notification side-effect reconciliation and downtime, then start only Render and reopen traffic after verification. If reverse restore cannot be validated, remain in maintenance and recover Lightsail; never point back to stale Neon or discard target writes. Record potentially sent-but-uncommitted pushes. No forced rollback solely because a guessed downtime target elapsed after activation.

## 8. Phase E — revisit legacy availability workarounds

Lightsail removes provider-driven idle suspension, not outages, latency or failed writes. Do not mix behavioral changes with the database cutover. Once the unchanged release is stable on Lightsail, inventory old workarounds, compare warm baseline with Render/Neon measurements if available, and implement a separate PR (or smaller independently reversible PRs). Classify each item as remove, simplify, retain or defer with a code reference and reason. Review both frontend and backend even though the frontend hosting stays unchanged.

| Area / current evidence | Planned change after cutover | Keep / acceptance |
| --- | --- | --- |
| Worker: deploy/cloudflare/worker.mjs returns 503, "The server is starting. Please try again shortly.", Retry-After: 10 on upstream fetch exception | Replace cold-start wording with neutral temporary-unavailable wording; distinguish planned maintenance from origin failure; standardize no-store error shape and bounded retry hints based on measured behavior | Keep HTTPS, trusted headers, manual redirect and no-store; simulated Tunnel outage returns recoverable 503, never a fake success or auth error |
| Session connectivity: apps/web/src/features/auth/components/sessionProvider/sessionProvider.tsx sets connected=false on network/5xx and blocks execute until successful refresh/read | Audit disconnected UX and recovery; distinguish browser offline, transient origin/database error and authentication failure. If needed, introduce a bounded, cancellable, backoff-based recovery probe while visible and online; trigger recovery on online/focus without request storms; restore usable state and invalidate owned queries after recovery. Avoid indefinite disabled controls after a single 503 when connection recovers | Keep sessions on transport failures, account/epoch checks, CSRF and refresh locks. 401 still follows existing authentication rules. Never automatically replay an uncertain write |
| Query/request behavior: apps/web/src/shared/api/apiClient.ts, features/auth/hooks/useOwnedQuery.ts and React Query defaults | Audit startup/loading screens, timeout/retry values and messages; remove any verified Render-wakeup-only waits, repeated warm-up calls or retry budget. Set ordinary latency/timeout expectations from measurements, classify 429/503/transport with bounded retry and jitter for safe reads, preserve cancellation and owner checks. Do not shorten legitimate operation deadlines arbitrarily | Some GETs settle or materialize domain state: do not assume every GET is side-effect free. Verify retries are safe under domain transaction semantics; honor Retry-After where relevant; avoid polling during maintenance |
| Commands and scheduling: shared/hooks/useCommand.ts, calendar/hooks/useSchedule.ts, focus/hooks/useFocus.ts | Improve pending/offline/error feedback and recovery after brief outage; retry exact uncertain command after explicit user action and recovered connectivity; avoid duplicate requests when the connection comes back | Keep account-scoped drafts, exact body/idempotency key, revision checks, uncertain-write handling, server-confirmed state and Undo expiry. Lost response may mean a committed mutation, even on Lightsail |
| Focus expiry: features/focus/hooks/useFocus.ts schedules one refetch at the server-derived deadline (plus 300 ms) | Verify that the active scheduler settles Focus without any open tab, and that reconnect/visibility/expiry refetch updates Focus, Calendar and Reports after background completion; consider simplifying only redundant recovery logic after tests. Audit potential duplicate browser local notification versus backend Web Push and define intended single-user-visible notification behavior before changing delivery | Keep local countdown anchors, server-authoritative completion, query invalidation, local audio and recovery after app/server restart. No per-second API polling; do not equate always-running API with realtime client push of state |
| Embedded scheduler: apps/api/cmd/api/main.go, internal/workers/scheduler.go, internal/repository/scheduleRepository.go, docs/architecture/notificationScheduler.md | Verify idle-time reminder delivery and local DB deadline-query latency. Audit any explicitly cold-start-specific workarounds; do not replace event-driven timer with polling or add a keep-alive service. Investigate late/missed sends only with measurements; changing lateness policy requires separate product approval | Retain durable outbox, retry/backoff, 15-minute reconciliation as a backup, startup catch-up, cancellation, deadline timeouts, bounded Horizon batches, cursor persistence and one-owner constraint. Process crashes, restarts and provider failures remain possible |
| Historical planning: request-boundary catch-up (docs/architecture/notificationScheduler.md and docs/features/07-planning-finalization.md) | Review whether always-running server warrants proactive historical finalization as a distinct product/architecture improvement. Default: retain current bounded on-demand design; do not add an all-account daily sweep just because the host is always on | Preserve per-account locking/watermark, timezone semantics, immutable history and regression tests; benchmark and design explicit background ownership if proactively finalizing later |
| Database and telemetry: pgx pool in apps/api/cmd/api/main.go, start.sh, deploy/monitoring.md and API diagnostics | Inventory Neon-specific connection parameters, cold-start retry/keepalive settings and Render-specific monitor timeout/wording; remove only verified provider-specific entries. Tune pool, timeouts and monitoring from actual local DB latency; use provider-neutral release metadata; shorten alert detection after validating monitor behavior and plan limits | Keep readiness vs liveness separation, reconnection/retry on real failures, transaction rollback, migrations, telemetry limits, graceful shutdown and backup/recovery |

The source review establishes these existing paths, not that all listed hypothetical warm-up mechanisms are present. Search for sleep/wake/cold-start/Render/Neon/keepalive/Retry-After and inventory each real occurrence before deleting it. Do not infer that all long timeouts, offline flows or request-driven domain behavior originated from the old free tiers. No behavioral defaults change in the migration PR.

Required regression and measurement gates:

- [ ] Healthy idle service returns without provider wake-up; record FE-to-API p50/p95/p99 latency, time-to-workspace after inactivity, Focus command latency, scheduler deadline query and delivery delay before/after where possible. Do not claim an exact improvement without comparable measurements.
- [ ] Simulate a brief API, Tunnel and PostgreSQL outage, 503/429, browser offline/online, aborted query, slow response and lost response after commit. Session remains valid on transport failure; UI recovers without reload when feasible; no duplicate writes; account switches cannot replay another user's command.
- [ ] Run existing unit, integration and all-browser E2E tests; extend proxy error tests, session recovery and uncertain-command regressions, plus Focus expiry/reconnect and notification tests. Test scheduler execution with browser closed and no API requests, paused/resumed Focus, recurring task rematerialization, restart during delivery/DB outage, retry, quiet hours and subscription revoke. Verify no old Cron, warm-up request or second scheduler is introduced.
- [ ] Validate calendar/report consistency after background settlement and catch-up; do not weaken existing 2s Next() budget or change 15-minute reconciliation just to reduce apparent retries.
- [ ] Release separately, observe errors/retry rates and user experience; retain rollback-compatible prior image and frontend Worker version. Revert individual regressions independently of the infrastructure migration.

## 9. Phase F — observation, cleanup and acceptance

Observe for at least seven days (owner may extend). Review uptime, resource peaks including swap/OOM, DB disk/WAL/connection growth, scheduler errors/retries and actual reminder delivery, backup success and cloud costs. Test host reboot and API upgrade/rollback in rehearsal before production; schedule any production reboot with maintenance awareness. Confirm clients can sign in and refresh sessions on the new host; old browser origin credentials and push subscriptions require explicit handling.

Acceptance criteria for migration closure:

- [ ] New frontend origin verified, previous-origin cookie/push implications handled; all same-origin API operations work; direct unauthorized origin API calls denied; no exposed DB or API host port; maintenance and origin rollback tested.
- [ ] Final source/target data parity verified before scheduler activation; schema intact, persistent volume survives recreate; production session/subscription database records preserved; browser origin change handled; no unaccounted writer or active legacy scheduler.
- [ ] Always-running behavior, restart recovery and real closed-tab pushes on dedicated devices verified; existing lateness and retry semantics unchanged. Scheduler deadline query/load within existing time budgets on representative dataset.
- [ ] CI release by immutable digest, compatible rollback rehearsal, off-host backup, replacement-host restore and monitoring verified with recorded evidence. No secrets or dumps in Git/CI.
- [ ] Legacy availability workarounds reviewed with documented remove/simplify/retain decisions; post-cutover changes pass healthy and fault-injection regressions, or separately tracked deferrals are approved.
- [ ] Owner signs off cost, measured downtime and backup/recovery targets; observe at least seven days and obtain explicit approval before irreversible decommission.

After sign-off, export/verify final rollback archive and retain required backups; delete Render service and Neon production resources only with explicit approval. Remove old provider credentials/integrations and stale monitor target, then remove render.yaml and obsolete Render/Neon deployment docs in cleanup PR; update deploy/README.md, deploy/monitoring.md and any architecture references to the real configuration. Keep local/test PostgreSQL setup, frontend workflow and empty Cron configuration. Do not delete unrelated Neon branches or services. Verify billing stops for removed resources, release unused IPs and clean temporary copies securely. Mark this proposal superseded by the deployed runbook rather than leaving two conflicting production instructions.

## 10. References and open decisions

- [Current deployment](../../deploy/README.md), [monitoring](../../deploy/monitoring.md), [scheduler](notificationScheduler.md), [API entrypoint](../../apps/api/start.sh), [proxy](../../deploy/cloudflare/worker.mjs).
- [Lightsail bundles](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html), [pricing](https://aws.amazon.com/lightsail/pricing/), [automatic snapshots](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-configuring-automatic-snapshots.html).
- [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/), [Workers VPC](https://developers.cloudflare.com/workers-vpc/get-started/), [VPC Tunnel requirements](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/). See [PR #40](https://github.com/Walker-mfj/TodoCal/pull/40) for the cutover runbook.
- [PostgreSQL 18 pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html), [official PostgreSQL container](https://hub.docker.com/_/postgres).

Before provisioning, confirm VPC/Tunnel connectivity and account binding permission, AWS region/cost/credit, Neon production size/extensions and actual deployed version, downtime window, backup credentials and retention, CI host connectivity and recovery targets. No provider dashboard settings, secret values, database contents, performance or actual costs were verified in creating this proposal; the gates above require that evidence during implementation.
