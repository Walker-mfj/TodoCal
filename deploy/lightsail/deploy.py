#!/usr/bin/env python3
"""Single-host, pull-based API deployer. Run as root from /opt/todocal."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from githubRelease import Client, DeploymentError, TAG

ROOT = Path("/opt/todocal")
STATE = ROOT / "deploy-state"
HOLD = STATE / "hold.json"
PRODUCTION = "todocal-api:production"
ROLLBACK = "todocal-api:rollback"
REVISION = "org.opencontainers.image.revision"
MIGRATIONS = "io.todocal.migrations"
SHA = re.compile(r"[0-9a-f]{40}")
FINGERPRINT = re.compile(r"[0-9a-f]{64}")


def log(message):
    print(message, flush=True)


def command(*args, capture=False, timeout=120):
    # Never dump Compose config or application environment to the journal.
    result = subprocess.run(args, cwd=ROOT, check=True, timeout=timeout,
                            stdout=subprocess.PIPE if capture else None, text=True)
    return result.stdout.strip() if capture else None


def compose(*args, **kwargs):
    return command("docker", "compose", *args, **kwargs)


def load_env():
    path = ROOT / "deploy.env"
    if path.stat().st_uid != 0 or path.stat().st_mode & 0o077:
        raise DeploymentError("deploy.env must be root-owned and mode 600")
    config = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or key not in {"GITHUB_APP_ID", "GITHUB_INSTALLATION_ID",
                                  "GITHUB_PRIVATE_KEY_PATH", "GITHUB_REPOSITORY"}:
            raise DeploymentError("Invalid deploy.env line")
        config[key] = value.strip()
    if set(config) != {"GITHUB_APP_ID", "GITHUB_INSTALLATION_ID",
                       "GITHUB_PRIVATE_KEY_PATH", "GITHUB_REPOSITORY"}:
        raise DeploymentError("Missing GitHub App configuration")
    return config


def image(ref):
    data = json.loads(command("docker", "image", "inspect", ref, capture=True))[0]
    labels = data.get("Config", {}).get("Labels") or {}
    return {"id": data["Id"], "sha": labels.get(REVISION),
            "fingerprint": labels.get(MIGRATIONS), "os": data["Os"], "arch": data["Architecture"]}


def compatible(a, b):
    left, right = a.get("fingerprint"), b.get("fingerprint")
    return bool(left and FINGERPRINT.fullmatch(left) and left == right)


def preflight():
    # Do not replace a differently configured service, scale replicas, or pull
    # a registry image. The stable local alias is part of the host contract.
    cfg = json.loads(compose("config", "--format", "json", capture=True))
    api = cfg.get("services", {}).get("api", {})
    if api.get("image") != PRODUCTION or api.get("build") or api.get("ports"):
        raise DeploymentError("Compose api must use todocal-api:production without build or published ports")
    if api.get("scale", 1) != 1 or api.get("deploy", {}).get("replicas", 1) != 1:
        raise DeploymentError("Exactly one API replica is required")
    ids = compose("ps", "--all", "--quiet", "api", capture=True).splitlines()
    if len(ids) != 1:
        raise DeploymentError("Exactly one existing API container is required")
    active = command("docker", "inspect", "--format", "{{.Image}}", ids[0], capture=True)
    if image(PRODUCTION)["id"] != active:
        raise DeploymentError("Production image tag differs from current container; recover manually")
    return image(active)


def ready(wait=90):
    deadline = time.monotonic() + wait
    successes = 0
    while time.monotonic() < deadline:
        try:
            body = compose("exec", "-T", "api", "wget", "-q", "-T", "5", "-O", "-",
                           "http://127.0.0.1:10000/readyz", capture=True, timeout=8)
            if json.loads(body).get("status") == "ready":
                successes += 1
                if successes == 3:
                    return True
            else:
                successes = 0
        except (subprocess.SubprocessError, ValueError, AttributeError):
            successes = 0
        time.sleep(3)
    return False


def write_hold(reason, previous=None, target=None):
    # Persistent interlock before the first production mutation. Survives a
    # service timeout, host restart, interrupted image switch, or failed rollback.
    data = {"reason": reason, "previous": previous, "target": target}
    fd, name = tempfile.mkstemp(dir=STATE)
    with os.fdopen(fd, "w") as out:
        json.dump(data, out)
        out.flush()
        os.fsync(out.fileno())
    os.replace(name, HOLD)
    sync_state()


def sync_state():
    fd = os.open(STATE, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def clear_hold():
    HOLD.unlink(missing_ok=True)
    sync_state()


def stop_api():
    compose("stop", "api", timeout=120)
    if compose("ps", "--status", "running", "--quiet", "api", capture=True):
        raise DeploymentError("API did not fully stop")


def activate(ref):
    command("docker", "tag", ref, PRODUCTION)
    compose("up", "-d", "--no-deps", "--force-recreate", "--pull", "never", "api", timeout=120)
    if image(PRODUCTION)["id"] != preflight()["id"] or not ready():
        raise DeploymentError("New API failed readiness")


def verify_image(loaded, release):
    if (loaded["sha"] != release["sha"] or loaded["fingerprint"] != release["fingerprint"]
            or loaded["os"] != "linux" or loaded["arch"] != "amd64"):
        raise DeploymentError("Image revision, migration fingerprint or architecture mismatch")


def prune_old(keep):
    # Only remove our immutable per-commit local tags; never prune volumes,
    # unrelated images, running containers or the rollback alias.
    try:
        tags = command("docker", "image", "ls", "todocal-api",
                       "--format", "{{.Tag}}", capture=True).splitlines()
        for tag in tags:
            if SHA.fullmatch(tag) and tag not in keep:
                command("docker", "image", "rm", f"todocal-api:{tag}")
    except subprocess.SubprocessError:
        log("Old API image cleanup incomplete; inspect disk manually.")


def download_image(client, release):
    if shutil.disk_usage(ROOT).free < 3 * release["size"] + 1024**3:
        raise DeploymentError("Insufficient free disk space for API image")
    with tempfile.TemporaryDirectory(prefix="api-release-", dir=STATE) as tmp:
        archive = Path(tmp) / "image.tar.gz"
        client.download(release, archive)
        command("docker", "load", "-i", str(archive), timeout=300)
    ref = f'todocal-api:{release["sha"]}'
    loaded = image(ref)
    verify_image(loaded, release)
    return loaded


def update(client, release, approved=None):
    if approved and release["tag"] != approved:
        raise DeploymentError("Approval must match the current latest API release exactly")
    current = preflight()
    if current["sha"] == release["sha"]:
        if not ready(wait=30):
            raise DeploymentError("Installed API is not ready")
        log("API already at latest release.")
        return 0
    same = compatible(current, release)
    if not same and not approved:
        log(f'Manual approval required for initial deployment or migration change: {release["tag"]}')
        return 3
    if not ready(wait=30):
        raise DeploymentError("Current API is not ready; recover it before deploying")
    loaded = download_image(client, release)
    # Re-check after potentially slow downloads, and avoid deploying a release
    # superseded while downloading. Manual approvals cannot float to new tags.
    if client.latest() != release:
        raise DeploymentError("Latest release changed during download; retry")
    if preflight()["id"] != current["id"]:
        raise DeploymentError("Current API changed during download")
    write_hold("deployment in progress", current["id"], loaded["id"])
    command("docker", "tag", current["id"], ROLLBACK)
    switched = False
    try:
        stop_api()
        if not same:
            # Old scheduler and API writers are stopped. The current backup
            # script takes its own lock and verifies upload before returning.
            command(str(ROOT / "backup.sh"), "frequent", timeout=1800)
        switched = True
        activate(loaded["id"])
    except (DeploymentError, subprocess.SubprocessError, OSError):
        # Never automatically start an older binary after a possible schema
        # change. The new startup runs migrations before starting the API.
        if not switched or same:
            try:
                stop_api()
                activate(current["id"])
                log("Previous API restored; deployment remains on hold.")
            except (DeploymentError, subprocess.SubprocessError, OSError):
                log("Rollback failed; manual recovery required.")
        else:
            log("Migration-sensitive deployment failed; no automatic rollback.")
        raise DeploymentError("Deployment failed; hold remains active") from None
    clear_hold()
    prune_old({loaded["sha"], current["sha"]})
    log(f'API deployment successful: {release["tag"]}')
    return 0


def rollback():
    current, previous = preflight(), image(ROLLBACK)
    if current["id"] == previous["id"]:
        raise DeploymentError("Rollback image is already active")
    if not compatible(current, previous):
        raise DeploymentError("Rollback blocked: migration fingerprint differs or is unknown")
    write_hold("operator rollback", current["id"], previous["id"])
    stop_api()
    activate(previous["id"])
    # Leave hold enabled; a subsequent event must not undo the rollback.
    log("Rollback complete; automatic deployment remains on hold.")


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--deploy", metavar="API_TAG")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--approve", metavar="API_TAG")
    mode.add_argument("--rollback", action="store_true")
    mode.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise DeploymentError("Run as root")
    os.umask(0o077)
    STATE.mkdir(mode=0o700, exist_ok=True)
    with (STATE / "lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if args.deploy:
                log("Deployment host busy; retry the exact release")
                return 75
            if args.approve or args.rollback or args.resume:
                raise DeploymentError("Another deployment operation is running")
            log("Deployment operation already running.")
            return
        if args.resume:
            if not ready(wait=30):
                raise DeploymentError("Resolve API readiness before clearing hold")
            preflight()
            clear_hold()
            log("Deployment hold cleared. Trigger a new GitHub Actions deployment explicitly.")
            return
        if args.rollback:
            # Even on a failed deployment, this only allows equal known schemas.
            rollback()
            return
        if HOLD.exists() and not args.check:
            if args.approve or args.deploy:
                raise DeploymentError("Deployment on hold; investigate before --resume")
            log("Deployment on hold; operator action required.")
            return
        client = Client(load_env())
        release = client.latest()
        if not release:
            if args.deploy or args.approve:
                raise DeploymentError("No API release published")
            log("GitHub App authenticated; no API release published.")
            return
        if args.check:
            log(f'GitHub App authenticated. Latest API: {release["tag"]}')
            return
        expected = args.deploy or args.approve
        if not TAG.fullmatch(expected) or release["tag"] != expected:
            raise DeploymentError("Requested release is not the exact latest API release")
        return update(client, release, args.approve)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except DeploymentError as exc:
        log(str(exc))
        sys.exit(1)
    except HTTPError as exc:
        log(f"GitHub HTTP error: {exc.code}")
        sys.exit(1)
    except (URLError, OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        # Avoid printing URLs with signed query parameters or raw credentials.
        log(f"Deployment operation failed: {type(exc).__name__}")
        sys.exit(1)
