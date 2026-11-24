# Blue-green deployment on one Lightsail host

Ordinary compatible releases can warm the inactive API slot, verify database
readiness, reload Nginx gracefully, drain old Nginx workers, then stop the
old API. The existing tunnel/VPC target stays api:10000. The database,
backup service, tunnel and independent deployment receiver are not restarted.
No extra VM, load balancer or published port. This is not HA: host, database,
proxy failure and incompatible migrations may still cause downtime.

## Scheduler ownership (single-host kernel lock)

Both API slots mount the SAME root-owned local lock directory, read-only,
and open the SAME pre-created inode. Only the process holding an exclusive
kernel flock runs the existing scheduler. It holds the lock until Scheduler.Run
returns after cancelling and waiting for all lanes. A database disconnect
does not release the lock or permit another scheduler to run. On process
death the kernel releases it. The standby attempts acquisition locally every
200 ms only while another process is leader. This deliberately replaces the
proposed session advisory lock: that lock could disappear with connection loss
while an in-flight Web Push request on another connection is still running.
This is not cross-host leadership; never copy this to two hosts or use NFS,
and never unlink/replace the lock while any API is running. Crashes during a
provider call retain existing at-least-once delivery limitations; no exactly-once
guarantee.

Both slots enable transactional NOTIFY on dirty domain commits. The leader
LISTENs on a separate dedicated PostgreSQL connection and wakes immediately
after reconnect as well as on notifications. Local wake and the 15-minute
reconciliation remain; no change to planning/notification semantics. The
standby does not run scheduler lanes. Failed NOTIFY aborts the corresponding
transaction instead of silently losing the wake. A listener outage can delay
remote wakes until reconnect or reconciliation, not create another leader.

## Fresh-host conversion / recovery (maintenance required)

Production has adopted Blue-Green; these steps are retained for rebuilding, not a pending proposal.

1. Merge PR and publish the new API. Before changing Compose, use existing
   single-slot mode and deploy the exact tested digest (startup script fingerprint
   changes). Verify actual revision, readiness, backups and restore.
   Only use an image with label io.todocal.scheduler-lock=v1.
2. Disable event delivery (LIGHTSAIL_EVENT_DEPLOY=false); ensure no active
   deployment and no retired timer. Copy updated deploy.py, blueGreen.py and
   templates from the reviewed main commit, root-owned. Inspect CPU/RAM with
   free -h and docker stats; the 2 GiB host has not been measured by this PR.
3. Back up the existing compose.yaml locally (root only). Prepare the stable
   lock inode and Nginx files without changing PostgreSQL volume/network:

       cd /opt/todocal
       install -d -m 755 scheduler-lock nginx nginx/active
       test ! -e scheduler-lock/leader.lock
       install -m 444 /dev/null scheduler-lock/leader.lock
       # install the reviewed nginx.conf to nginx/nginx.conf (mode 644)
       python3 - <<'PY'
       import blueGreen, deploy
       blueGreen.atomic_config(deploy, "blue")
       PY
       docker tag todocal-api:production todocal-api:blue

   Do not rerun lock creation on an existing installation. Use the actual
   image digest for Nginx after verifying a supported release; the example
   tag is illustrative. Integrate the services from
   bluegreen.compose.example.yaml into a new staged host Compose file,
   preserving postgres and cloudflared, project name, database volume and
   ingress network, all secrets and actual network names. Do not replace
   the host Compose file blindly. Do not start both slots using a generic
   up command. The api service becomes Nginx; the old API service is renamed
   api-blue; api-green stays stopped until needed.
4. Set Worker MAINTENANCE_MODE=true; verify writes fenced. With the
   ORIGINAL Compose file, stop and remove only the old api container
   (docker compose stop api; docker compose rm -f api). Confirm it is
   fully stopped before any slot starts. Install the staged Compose file.
   Explicitly start blue and proxy, preserving postgres and cloudflared:

       docker compose --profile bluegreen up -d --no-deps api-blue api
       docker compose --profile bluegreen exec -T api wget -qO- http://127.0.0.1:10000/__slot
       docker compose --profile bluegreen exec -T api wget -qO- http://127.0.0.1:10000/readyz

   Confirm blue, ready, one running API slot, compatible label and correct
   shared mount. If setup fails, keep maintenance, stop new slots/proxy
   before restoring the original single-slot config and known compatible
   image. Do not remove volumes.
5. Enable the host switch only after validation:

       install -m 600 /dev/null /opt/todocal/bluegreen.enabled
       python3 deploy.py --check

   Set Worker MAINTENANCE_MODE=false, verify public readiness and authenticated
   smoke test. Remove the false override (or set true) and manually dispatch CI. First
   ordinary update should exercise both slots while monitoring errors, RAM,
   scheduler ownership and active slot. Test against disposable infrastructure
   before claiming zero downtime. The deployment guard requires 640 MiB
   available before overlap; template caps each Go container at 512 MiB.
   Tune only from measured headroom; no upgrade is assumed.

## Normal deployment and rollback

The existing event sends the exact public GHCR tested digest. The deployer verifies
both Compose definitions, actual active container mounts/labels, active
proxy slot, migration fingerprint, fixed digest and image labels. It holds the
existing deploy lock while starting the candidate (no startup migrations).
Nginx configuration is atomically replaced on the stable directory mount,
syntax tested, then gracefully reloaded. Wait for the selected slot,
pre-reload workers to exit and readiness before stopping old API. Nginx
worker shutdown timeout is 45 seconds, so unusually long in-flight requests
can still be terminated; no absolute zero-downtime promise. New requests
should continue during normal reload. The scheduler hands off after the
old process drains; a bounded short scheduling gap is possible.

The last known rollback image is pinned separately as
todocal-api:bluegreen-rollback. Only a successful forward handoff (including
final proxy readiness) updates this tag to the outgoing healthy image,
before clearing the durable hold or pruning images. Failed candidates may
overwrite the inactive slot tag, but never this dedicated rollback alias.
python3 deploy.py --rollback uses only the pinned image ID, checks its known
migration fingerprint and scheduler-lock support, starts it in the inactive
slot, switches/drains, stops the old slot and leaves the hold set. A missing
pin or incompatible schema blocks rollback; there is no fallback to the
inactive slot tag or old single-slot rollback alias. A successful migration
change pins the outgoing image too, but its different fingerprint blocks
rollback. The pin is not changed by manual rollback: the outgoing version
may be unhealthy. Once the pinned version is active, a further rollback is
blocked until another forward deployment succeeds.
The first blue-green installation has no eligible pin until a successful
forward handoff; do not seed it from an unverified inactive image.
An unready candidate never changes traffic; a failed/ambiguous reload leaves
both slots and the durable hold for manual inspection (safe scheduler lock
still applies). Do NOT blindly stop either slot or clear the hold. Confirm
on-disk nginx/active/active.conf agrees with actual proxy /__slot, then
recover one healthy slot and stop the other. Use --resume only after one
healthy slot remains and no unresolved migration. Do not issue unrelated
docker compose up or remove-orphans commands.

## Schema changes

Unknown or changed fingerprints automatically select the offline path.
The deployer stops the old API and scheduler, requires the existing verified
off-host backup, runs one explicit migration-only container and starts the
candidate with startup migrations disabled. No manual approval is needed.
Keep the Worker in normal mode and leave event delivery enabled for routine
releases; the Worker reports API unavailability while the old slot is stopped.
This path is not zero downtime. After migration starts, no automatic
old-binary rollback; on failure retain the hold, inspect actual migration
state and recover forward or use a tested restore plan under operator
maintenance. After local and public readiness, the same CI-triggered workflow
publishes the matching frontend. Do not change data semantics incompatibly
even with identical migration fingerprints, or break the old frontend during
the backend-first handoff.

## Verification before activation

CI adds lock/drain and transaction broadcast unit tests plus mocked deploy
flow tests. Require real Linux/Compose/Nginx and PostgreSQL acceptance:
- One scheduler runs during overlap, including database disconnect and shutdown.
- Dirty write on the standby wakes the leader and listener reconnect refreshes.
- In-flight requests complete through reload and old workers drain before stop.
- Failed candidate, ambiguous reload, migration failure and rollback keep safe
  traffic/hold state; reboot recovery does not start duplicate schedulers.
- A -> B successful, then C fails readiness after overwriting the inactive
  tag: rollback must recover A, not C. Verify the independent pin survives.
- Repeated HTTP probes and authenticated writes through Worker throughout a
  compatible deployment; compare p95 and 5xx, inspect memory/OOM, focus and push.
- Neither DB nor tunnel restarts. Record measured downtime; don't assume none.

Rollback can recover an unhealthy running API without requiring its readiness.
The proxy must still identify the active slot and the slot/image state must be
unambiguous; the previous image must have a compatible migration fingerprint
and pass readiness before traffic switches. If the active container is no
longer identifiable as running, use manual recovery; do not bypass the hold.
