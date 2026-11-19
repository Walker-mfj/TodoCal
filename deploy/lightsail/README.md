# Lightsail API releases (GitHub App, no PAT)

The production owner reports that Lightsail, PostgreSQL, Cloudflare Tunnel,
S3 backups and monitoring are already configured. The live host was not
inspected by this change. Keep Render/Neon fenced until the recovery window
is over; never fall back to them automatically.

## Publish

Full existing CI (web, Go, integration, lint, browser) must succeed on main.
The final reusable workflow uses only its job-scoped GITHUB_TOKEN with
contents:write. It compares apps/api against the last published API commit,
including changes from earlier failed CI runs, and builds linux/amd64 only
if necessary. No new GitHub secret, PAT, GHCR, runner on Lightsail or inbound
SSH is required. Rerun CI on main (manual dispatch) for recoverable publish
failures. The workflow publishes a draft only after uploading the complete
Docker archive and verifying GitHub's SHA-256 asset digest; it then makes
the release latest. Tags are api-<full SHA>; only the API pipeline should
control the repository's latest release. Never edit/replace a published
image. Enable GitHub immutable releases if available for this repository.
An abandoned draft may remain after failure or cancellation; inspect it
before deleting. Retain a few recent published releases for recovery and
delete obsolete releases manually only after verifying deployed/rollback
revisions. Release assets must be below 2 GiB.

GitHub Releases and Apps do not require an extra paid service. Existing
private-repository CI minutes are still metered; check remaining Actions
quota and spending settings. No extra artifact upload or duplicate CI run.
A five-minute poll uses outbound API calls, not Actions minutes. Download
only when the image differs and the migration gate permits it. Monitor
Lightsail transfer allowance and disk space. Frequent manual reruns and
migration backups may consume quota; no claim of a hard billing cap.

## Install on the existing host

Create an App installed only on TodoCal, repository Contents read-only
(Metadata read-only), webhook off. Store the PEM root-owned mode 600 at
/opt/todocal/secrets/github-app.pem (directory mode 700); configure
deploy.env using the example, root-owned mode 600. No client secret.
The app signs a short-lived JWT and obtains a repository-scoped read-only
installation token. Credentials and signed download URLs are never logged.
The PEM is a long-lived secret: rotate if exposed, keep out of Git and chat.

On Mac, from a trusted checkout of the merged main commit:

    scp deploy/lightsail/{deploy.py,githubRelease.py,todocal-deploy.service,todocal-deploy.timer} todocal:~/

On Lightsail:

    sudo -i
    cd /opt/todocal
    install -m 700 /home/ubuntu/deploy.py ./deploy.py
    install -m 600 /home/ubuntu/githubRelease.py ./githubRelease.py
    install -m 644 /home/ubuntu/todocal-deploy.service /etc/systemd/system/
    install -m 644 /home/ubuntu/todocal-deploy.timer /etc/systemd/system/
    systemctl daemon-reload
    python3 deploy.py --check

Requires Python 3, openssl, Docker Compose v2, GNU/Linux amd64. Keep
existing compose.yaml and env files. The api service must use exactly
todocal-api:production, no build directive, no published port, one
container, existing readiness on port 10000, and the existing postgres
and cloudflared services. The deployer keeps this stable local image
alias, so ordinary Compose commands keep using the installed version.
Ensure api.env has no stale RENDER_GIT_COMMIT override (image now supplies
the revision for existing error/diagnostics metadata). Keep API_BACKEND=vpc
in Cloudflare. Ensure enough disk space and no competing manual deployment.
Existing /opt/todocal/backup.sh frequent must work including S3 checksum
verification and any heartbeat notification. No changes to backups here.

After CI publishes a release, --check prints its tag. First deployment
requires manual approval, because the existing hand-built image lacks
migration labels. Confirm isolated backup restore and a healthy live
API, then run using the exact printed tag:

    python3 deploy.py --approve api-REPLACE_WITH_FULL_SHA
    docker compose ps
    curl -fsS https://todocal.digitalhome.workers.dev/api/readyz
    systemctl enable --now todocal-deploy.timer
    systemctl list-timers --all | grep todocal-deploy
    journalctl -u todocal-deploy.service -n 50

There is brief downtime when the single API container is replaced; the
scheduler must not overlap. Plan maintenance if needed. Do not enable
the timer until the first release and live readiness are verified.
The timer checks five minutes after the previous unit finishes. Only API
is stopped/recreated; database and tunnel are untouched. Docker archive
SHA-256 digest and asset size are checked before load; image revision, migration
fingerprint and architecture must agree with the release. Local readiness
is checked three times; also check the public Worker endpoint manually.
A release verifies transport integrity, not independent publisher trust.

## Migration gate, rollback and failure

Automatic deployment requires an identical known fingerprint of migration
files, the migration runner, startup script and Go module manifests. First deployment or any
fingerprint change is not automatically applied. The journal prints the
exact release tag awaiting approval. Review SQL and compatibility before
approval. An approved migration change stops the old API/scheduler, runs
the existing off-host backup, then starts the new API, whose startup
runs migrations before serving. A failed backup prevents migration.
The fingerprint does not guarantee backward-compatible application data;
even same-fingerprint changes must preserve old data semantics. Split
incompatible data/API/frontend changes into staged releases. Frontend
deploy remains independent, not an atomic release; do not merge a frontend
requiring a newer backend until that backend is live.

For same-fingerprint releases, a failed start/readiness attempts to restore
the previous image after stopping the failed container. No automatic
rollback after a possible migration change; inspect database state, repair
forward or use a validated restore plan while users are fenced. Backup
restore loses writes after backup; don't restore a live DB blindly.
A durable deploy-state/hold.json interlock is written before any mutation
and remains after failure, interrupted deployment or manual rollback.
The timer won't undo a rollback or keep restarting a failing release.

    systemctl stop todocal-deploy.timer
    journalctl -u todocal-deploy.service -n 100
    docker compose ps
    python3 deploy.py --rollback

Manual rollback also requires matching known migration fingerprints; the
first hand-built image is intentionally not automatically rollback-safe.
If the stable tag and current container differ after an interruption,
inspect hold.json and docker image/container state; repair explicitly
before running the deployer again. Avoid dumping env/Compose config to
logs. Once recovered and ready, explicitly clear the hold (the next
poll may deploy the latest release again):

    python3 deploy.py --resume
    systemctl enable --now todocal-deploy.timer

For a pending migration, run --approve with the current exact tag.
Do not delete the hold file to bypass checks. An automatic poll does not
create a backup for schema-compatible releases; the existing schedule
continues. The deployer keeps current and previous immutable local image
tags and the stable/rollback aliases, removes older matching local API
tags after successful deployment only, and never prunes volumes or
unrelated images. Check disk periodically with docker system df and df -h.
Existing Better Stack readiness monitor alerts on sustained outage;
pending approvals and deploy failures need journal inspection, no extra
paid monitoring configured in this PR.

## Tests and references

Run python3 -m unittest -v testDeploy from this directory; bash -n publish.sh
and a successful main CI are required. Validate release upload, App
authentication, first deploy and local/public readiness on the actual host
before enabling the timer. Tests mock Docker/GitHub; they do not substitute
for host acceptance.

- https://docs.github.com/en/rest/releases/assets
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows
