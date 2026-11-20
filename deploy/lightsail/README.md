# Lightsail API images (GHCR + Workers VPC)

Production owner reports Lightsail, PostgreSQL, Cloudflare Tunnel, S3 backups
and monitoring configured. Live host not inspected. Keep old Render/Neon fenced.

## Publish

Successful trusted main CI triggers the independent non-cancelling Deploy
backend workflow. Only the publishing job has contents:read and packages:write.
It signs into GHCR with the ephemeral GITHUB_TOKEN, builds linux/amd64
and pushes ghcr.io/walker-mfj/todocal-api:sha-<commit>, then promotes :tested.
If the API tree and migration fingerprint match the tested image, it reuses
the same digest and re-delivers the event, including after missed delivery.
No Docker archives, release asset upload or GitHub App. Only this workflow
should update the tested tag. Protect main and package write access; digest
verification secures content identity, not independent publisher attestation.
The tag is a discovery pointer; production always pulls a fixed sha256 digest.

## One-time transition from GitHub Releases

1. Keep LIGHTSAIL_EVENT_DEPLOY unset/false. Inspect old deployment status;
   disable/remove the old timer/service only when idle. Keep backup timers,
   existing API and rollback image. Merge and run CI on main to publish.
2. In GitHub Packages, make todocal-api **Public** separately from the repo.
   Grant Actions access only to the TodoCal repository; do not embed secrets
   in public images. Verify anonymous pull from Lightsail or a clean client:

       docker pull --platform linux/amd64 ghcr.io/walker-mfj/todocal-api:tested

   The diagnostic pull may cache layers; it does not change the running API.
   Publishing authenticates with GITHUB_TOKEN; the host needs no Docker login,
   PAT, GitHub App, PEM or deploy.env. Public images/source are intentional.

3. Copy deploy.py and registry.py from the reviewed merged main commit:

       scp deploy/lightsail/{deploy.py,registry.py,blueGreen.py} todocal:~/

   On Lightsail as root:

       cd /opt/todocal
       install -m 700 /home/ubuntu/deploy.py ./deploy.py
       install -m 600 /home/ubuntu/registry.py ./registry.py
       install -m 600 /home/ubuntu/blueGreen.py ./blueGreen.py
       python3 deploy.py --check

   This resolves and verifies the public tested manifest and prints its digest.
   A private package, missing image or inaccessible registry fails closed.
   Once the new system is verified, remove the retired githubRelease.py and
   deploy.env, revoke the GitHub App key/uninstall only if dedicated to this
   deployer. Retain old release assets/image until recovery is verified.
   Do not remove api.env, backup.env, cloudflared.env or the HMAC secret.

4. Existing compose.yaml API uses todocal-api:production with no build,
   no published ports and one replica, readiness on port 10000. Keep
   database, tunnel, volumes, networks and env files as-is. Ensure no stale
   RENDER_GIT_COMMIT override. Require working backup.sh frequent and a
   verified restore. Python 3 and Docker Compose v2 on Linux amd64.
   Keep event delivery disabled until this and the receiver setup are verified.
   Review current/new migration fingerprints and use the exact reported digest:

       python3 deploy.py --deploy sha256:REPLACE_WITH_FULL_DIGEST

   If unknown/changed migration fingerprint, review SQL and approve explicitly:

       python3 deploy.py --approve sha256:REPLACE_WITH_FULL_DIGEST
       docker compose ps
       curl -fsS https://todocal.digitalhome.workers.dev/api/readyz

   Single-slot replacement has brief downtime. A first GHCR image can be
   automatically compatible if existing image has the same known fingerprint.
   An old image with unknown fingerprint requires manual approval.
   Configure [event-driven deployment](eventDeployment.md) and never re-enable
   release polling.

## Optional blue-green mode

See [blue-green deployment](blueGreen.md) for one-time host transition,
shared scheduler leadership, resource guard, graceful Nginx reload and
maintenance for changed migrations. Single-slot remains default until
explicitly enabled on the host.

## Migration, rollback, failure

The host resolves the fixed public :tested manifest by anonymous HTTPS,
validates its digest, pulls only the approved/signed exact digest using Docker
and validates local RepoDigests, revision/source/migration labels and architecture.
It rechecks tested after pulling, while holding the host deploy lock.
The candidate is pulled before evaluating migration compatibility; this only
caches image data, never runs it. Approval is bound to digest, not a mutable
tag. Existing image IDs/digests are checked for no-op with readiness.
An already-installed image is not restarted. If registry resolution fails,
no production mutation is attempted. A digest protects content, not authorship.

Changed/unknown migration fingerprint requires approval. Old API/scheduler
stops first, then the existing off-host backup must succeed before starting
the new API (startup applies migration). Fence writes when needed.
A changed fingerprint blocks automatic rollback after possible migration.
Compatible failures attempt to restore the previous image. Even identical
fingerprints do not prove compatible application data semantics; stage changes.
Frontend deploy remains independent. Do not merge frontend incompatible with
the live backend.

A persistent deploy-state/hold.json interlock survives interrupted jobs,
failed deployments and rollback. Never delete it to bypass checks.

    journalctl -u 'todocal-deploy-job@*.service' -n 100
    docker compose ps
    python3 deploy.py --rollback
    # after investigation and readiness verified:
    python3 deploy.py --resume

Rollback requires known equal migration fingerprints; retain current and
previous image aliases. The deployer can prune only older local API image
references after success; never prunes volumes or unrelated images. Retain
GHCR versions needed for recovery; only manually delete obsolete digests
after checking actual deployed/rollback versions. Check free -h, df -h,
docker system df and readiness metrics. No extra paid service intended;
review current public package and Workers VPC terms.

## Verification

Run python3 -m unittest -v testDeploy testTrigger testPublish and
bash -n publish.sh. Require main CI, first GHCR publish, separate public
visibility, actual anonymous manifest/pull, deployment and local/public
readiness before enabling automatic event delivery. Mocked tests are not
Linux/Compose acceptance. No live infrastructure changes on merge.

- https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility
