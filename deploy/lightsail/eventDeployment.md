# Event-driven Lightsail deployment

Opt-in. No live infrastructure changes are made by merging these files.
The GitHub App remains read-only and downloads releases. CI signs a single
event using an independent 32-byte hex secret. The Worker verifies HMAC
and timestamp and sends the bounded request through a second private
VPC service to deploy-receiver:8080. The receiver has no secrets, Docker
socket, database access or shell command execution. It forwards a bounded
message over a group-restricted Unix socket. Root systemd verifies the
signature again, atomically records the random event ID and tag, then
launches a fixed per-event service. Replays of the same ID return the
existing state, not a new deployment. The deploy script uses its existing
host lock, exact latest tag, archive checksum, hold, migration gate and
readiness/rollback logic. Jobs are independent of the API and of the
HTTP request. A cancelled Actions run cannot cancel an admitted job.

## One-time setup (owner-operated)

1. Merge and confirm CI; disable and remove only the old deploy timer/service
   (inspect active deployment first, never stop a running job mid-deploy).
   Keep PostgreSQL backup timers. Verify first release and restore test.
2. Copy the new deploy.py, githubRelease.py, triggerProtocol.py,
   triggerHost.py, deployReceiver.py, deploy-trigger.compose.yaml and
   three systemd unit files (todocal-trigger.socket,
   todocal-trigger@.service, todocal-deploy-job@.service) from main to
   /opt/todocal (root-owned, scripts mode 600 or 700; units root-owned
   mode 644 in /etc/systemd/system). Ensure no stale deploy timer is enabled.
3. Run as root, verify GID 10002 is unused before creating the group:

       getent group 10002
       groupadd --gid 10002 todocal-trigger
       install -d -m 755 /opt/todocal/trigger-socket
       umask 077
       openssl rand -hex 32 > /opt/todocal/secrets/trigger.key
       chmod 600 /opt/todocal/secrets/trigger.key
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
   Do not use the existing API service ID. Run Deploy frontend on main
   and verify both bindings, API_BACKEND=vpc and readiness.
6. Confirm unsigned POST /api/internal/deploy gets 401, no job started.
   Set repository variable LIGHTSAIL_EVENT_DEPLOY=true only after installation.
   Run CI via workflow_dispatch on main to trigger the exact latest release.
   A new backend release triggers automatically after all main CI jobs pass.
   Unchanged API pushes skip image build and event; manual dispatch retries
   latest release. If no new release and no manual dispatch there is no event.
   On first/changed migration fingerprint, Actions reports needs_approval;
   review and use python3 deploy.py --approve api-<exact-sha> on host.
   Then rerun CI manually to verify the already-installed release.

## Operations

Inspect journalctl -u 'todocal-deploy-job@*.service' and root-owned
/opt/todocal/deploy-events/<request-id>.json. GitHub Actions prints the ID.
Success means exact release deployed or already current and public readiness.
Failed or timed-out events need investigation; never blindly restart an
unresolved queued/running job. A host reboot may leave such records; verify
the deployment hold and actual running revision before retrying with a new
event. Inspect records before manually cleaning unresolved ones; terminal
records are pruned after seven days on new requests. Rollback/hold remains
as described in README. Manual commands --deploy and --approve require exact
latest API tag; no bare polling command remains.

Disable delivery via LIGHTSAIL_EVENT_DEPLOY=false. Stop the socket and
receiver only when no work is in flight; do not stop API/DB/tunnel.
No additional purchased service; review Workers/VPC current limits,
GitHub Actions minutes (wait is metered only per deployment), Docker image
download and RAM. This is still one API container and brief downtime.
