# Lightsail API images (GHCR + Workers VPC)

Production uses Lightsail PostgreSQL, Cloudflare Tunnel, private deployment receiver and Blue-Green API slots. See [production overview](../README.md). Keep backup timers and the host deployment lock intact.

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

## Runtime and routine release

- Host /opt/todocal: root-managed compose.yaml, api.env, backup.env, cloudflared.env, deploy.py, registry.py, blueGreen.py, triggerProtocol.py, triggerHost.py, deployReceiver.py and secrets/trigger.key.
- Nginx service api:10000 routes to exactly one active slot; the other runs only during handoff. Both use the same local scheduler lock. Preserve DB, tunnel and receiver throughout routine releases.
- The root-only bluegreen.enabled marker selects Blue-Green mode. See [setup and recovery](blueGreen.md) and [event delivery](eventDeployment.md) for host rebuilds. Set LIGHTSAIL_EVENT_DEPLOY=false before maintenance or fresh-host provisioning; ordinary deployment is enabled when unset.
- Check current state without dumping credentials:

      cd /opt/todocal
      docker compose --profile bluegreen ps
      docker compose exec -T api wget -qO- http://127.0.0.1:10000/__slot
      python3 deploy.py --check
      curl -fsS https://todocal.digitalhome.workers.dev/api/readyz

CI success triggers publication and delivery. A matching existing digest is a readiness-checked no-op. The first Blue-Green rollout of PR #51 succeeded on 2026-11-20; the owner reported HTTP 200 at one-second readiness probes. This is measured evidence, not an absolute zero-downtime guarantee. Manual rollback and provider-call overlap still require explicit operational verification.

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

Changed/unknown migration fingerprint requires approval. Set maintenance and pause event delivery before approving. In Blue-Green mode, stop the old writer, require the off-host backup, run one migration-only container, then start the candidate with implicit migrations disabled.
A changed fingerprint blocks automatic rollback after possible migration.
Compatible failures before the switch leave the old route active; ambiguous switches retain both slots and the hold for operator recovery. Even identical
fingerprints do not prove compatible application data semantics; stage changes.
Frontend deploy remains independent. Do not merge frontend incompatible with
the live backend.

A persistent deploy-state/hold.json interlock survives interrupted jobs,
failed deployments and rollback. Never delete it to bypass checks.

    journalctl -u 'todocal-deploy-job@*.service' -n 100
    docker compose --profile bluegreen ps
    python3 deploy.py --rollback
    # after investigation and readiness verified:
    python3 deploy.py --resume

Rollback requires known equal migration fingerprints and the dedicated todocal-api:bluegreen-rollback pin, created only after a successful handoff; retain active and pinned images. The deployer can prune only older local API image
references after success; never prunes volumes or unrelated images. Retain
GHCR versions needed for recovery; only manually delete obsolete digests
after checking actual deployed/rollback versions. Check free -h, df -h,
docker system df and readiness metrics. No extra paid service intended;
review current public package and Workers VPC terms.

## Verification

Run python3 -m unittest -v testDeploy testTrigger testPublish testBlueGreen and
bash -n publish.sh. Require main CI, first GHCR publish, separate public
visibility, actual anonymous manifest/pull, deployment and local/public
readiness before enabling automatic event delivery on a fresh host. Mocked tests are not Linux/Compose acceptance; normal merges on main trigger production deployment.

- https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility
