# Event-driven Lightsail deployment

Production uses this event-driven path. On a fresh host, explicitly disable delivery until installation is complete.
The public GHCR image is pulled anonymously by fixed digest. CI signs a single
event using an independent 32-byte hex secret. The Worker verifies HMAC
and timestamp and sends the bounded request through a second private
VPC service to deploy-receiver:8080. The receiver has no secrets, Docker
socket, database access or shell command execution. It forwards a bounded
message over a group-restricted Unix socket. Root systemd verifies the
signature again, atomically records the random event ID and digest, then
launches a fixed per-event service. Replays of the same ID return the
existing state, not a new deployment. The deploy script uses its existing
host lock, exact tested digest, Docker content verification, hold, automatic offline migration and
readiness/rollback logic. Jobs are independent of the API and of the
HTTP request. A cancelled Actions run cannot cancel an admitted job.

## One-time setup (owner-operated)

1. Set LIGHTSAIL_EVENT_DEPLOY=false before provisioning a fresh host. Merge and confirm CI; disable and remove only the old deploy timer/service
   (inspect active deployment first, never stop a running job mid-deploy).
   Keep PostgreSQL backup timers. Verify first release and restore test.
2. Copy the new deploy.py, registry.py, blueGreen.py, triggerProtocol.py,
   triggerHost.py, deployReceiver.py, deploy-trigger.compose.yaml and
   three systemd unit files (todocal-trigger.socket,
   todocal-trigger@.service, todocal-deploy-job@.service) from main to
   /opt/todocal. All scripts root-owned, mode 600 or 700, EXCEPT
   deployReceiver.py: root:root mode 644 so container UID 10002 can read it.
   Systemd units root-owned mode 644 in /etc/systemd/system. Example:

       install -o root -g root -m 644 /home/ubuntu/deployReceiver.py /opt/todocal/deployReceiver.py

   Keep the trigger key mode 600. No GitHub App credentials are needed. Ensure no stale deploy timer is enabled.
3. Run as root, verify GID 10002 is unused before creating the group:

       getent group 10002
       groupadd --gid 10002 todocal-trigger
       install -d -m 755 /opt/todocal/trigger-socket
       umask 077
       test -f /opt/todocal/secrets/trigger.key || openssl rand -hex 32 > /opt/todocal/secrets/trigger.key
       chmod 600 /opt/todocal/secrets/trigger.key
       systemd-analyze --recursive-errors=no verify /etc/systemd/system/todocal-trigger.socket /etc/systemd/system/todocal-trigger@.service /etc/systemd/system/todocal-deploy-job@.service
       systemctl daemon-reload
       systemctl enable --now todocal-trigger.socket

   Transfer the secret through trusted secret-entry UI, not Git/chat,
   to the repository Actions secret DEPLOY_TRIGGER_SECRET and Cloudflare
   Worker secret DEPLOY_TRIGGER_SECRET. Same 64 lowercase hex characters.
   Rotate both and root file together while delivery is disabled.
4. Verify Compose project name/networks are the existing ones (ingress).
   Overlay deploy-trigger.compose.yaml adds only receiver. Inspect image
   provenance/pin digest before deployment; do not publish any port.
   From /opt/todocal:

       docker compose -f compose.yaml -f deploy-trigger.compose.yaml up -d --no-deps deploy-receiver

   Keep the overlay file in place. Don't use --remove-orphans with base
   Compose; it would remove the receiver. For persistent management add the
   overlay to your root-managed COMPOSE_FILE configuration after verifying
   backup and existing deployment commands. Do not restart DB/tunnel.
5. In Cloudflare Connectivity Directory create separate HTTP VPC Service
   todocal-deploy (host deploy-receiver, port 8080, existing named tunnel).
   Set repository Actions variable DEPLOY_VPC_SERVICE_ID to its real UUID.
   Frontend deploy workflow adds the binding to its temporary Wrangler config.
   Do not use the existing API service ID. For initial provisioning only,
   an owner must bootstrap the Worker from a successful main CI checkout
   using the build, test, source-map and binding-configuration commands in
   deployFrontend.yml before Wrangler publication. Keep automatic delivery
   disabled and prevent concurrent releases. Verify both bindings and the
   deployment route before enabling delivery. This manual bootstrap is not
   an alternative routine frontend release path.
6. Confirm unsigned POST /api/internal/deploy gets 401, no job started.
   Make the GHCR package public and verify anonymous access first (README).
   Remove the LIGHTSAIL_EVENT_DEPLOY override (or set true) only after installation.
   Run CI via workflow_dispatch on main. Deploy production runs on successful
   trusted main CI completion and serializes backend and frontend publication
   without cancelling an in-flight release.
   Every successful current-main CI run delivers the latest matching tested digest,
   even when API files have not changed. Already-installed digests are no-ops
   after readiness verification. This recovers a previously missed delivery.
   On the first merge, if workflow_run did not start, manually run CI on main.
   On first/changed migration fingerprint, the host automatically stops API
   writers, requires the verified off-host backup and performs offline migration.
   After successful backend delivery and public readiness, frontend publishes
   in the same workflow. No approval or manual maintenance toggle is needed.
   A legacy needs_approval response still blocks frontend; upgrade the host
   scripts and systemd unit using the Lightsail README before enabling delivery.

## Operations

Inspect journalctl -u 'todocal-deploy-job@*.service' and root-owned
/opt/todocal/deploy-events/<request-id>.json. GitHub Actions prints the ID.
Success means exact digest deployed or already current and public readiness.
Busy events retry only lock contention every five seconds, for at most ten
minutes before reporting failure. Superseded digests fail tested-image validation;
newer events must be delivered separately. A deploy attempt is bounded by
50 minutes, systemd by 65 minutes and the CI client by 70 minutes, allowing
for backup and migration. Failed or timed-out events need investigation; never blindly restart an
unresolved queued/running/busy job. A host reboot may leave such records; verify
the deployment hold and actual running revision before retrying with a new
event. Inspect records before manually cleaning unresolved ones; terminal
records are pruned after seven days on new requests. Rollback/hold remains
as described in README. Manual command --deploy requires the exact
tested image digest; no bare polling command remains.

Delivery is enabled by default. Disable it explicitly via LIGHTSAIL_EVENT_DEPLOY=false, including during maintenance. Stop the socket and
receiver only when no work is in flight; do not stop API/DB/tunnel.
No additional purchased service; review Workers/VPC current limits,
GitHub Actions minutes (wait is metered only per deployment), Docker image
download and RAM. Single-slot mode has brief downtime; see [blue-green deployment](blueGreen.md) for the production compatible-image handoff.
