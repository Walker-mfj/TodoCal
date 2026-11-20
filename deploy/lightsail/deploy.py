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
from registry import Registry, DeploymentError, DIGEST, IMAGE

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


def image(ref):
    data = json.loads(command("docker", "image", "inspect", ref, capture=True))[0]
    labels = data.get("Config", {}).get("Labels") or {}
    return {"id": data["Id"], "sha": labels.get(REVISION),
            "fingerprint": labels.get(MIGRATIONS), "leader": labels.get("io.todocal.scheduler-lock"),
            "os": data["Os"], "arch": data["Architecture"],
            "source": labels.get("org.opencontainers.image.source"),
            "digests": data.get("RepoDigests") or []}


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


def verify_image(loaded, digest):
    if (not DIGEST.fullmatch(digest) or f"{IMAGE}@{digest}" not in loaded["digests"]
            or not SHA.fullmatch(loaded["sha"] or "")
            or not FINGERPRINT.fullmatch(loaded["fingerprint"] or "")
            or loaded["source"] != "https://github.com/Walker-mfj/TodoCal"
            or loaded["os"] != "linux" or loaded["arch"] != "amd64"):
        raise DeploymentError("Image digest, provenance labels or architecture mismatch")


def prune_old(keep):
    # Delete only old local references for the dedicated API image. Keep
    # active/rollback digests and local aliases; never prune volumes.
    try:
        rows = command("docker", "image", "ls", "--digests", IMAGE,
                       "--format", "{{.Digest}}", capture=True).splitlines()
        for digest in set(rows):
            if DIGEST.fullmatch(digest):
                ref = f"{IMAGE}@{digest}"
                if image(ref)["id"] not in keep:
                    command("docker", "image", "rm", ref)
        tags = command("docker", "image", "ls", "todocal-api",
                       "--format", "{{.Tag}}", capture=True).splitlines()
        for tag in tags:
            if SHA.fullmatch(tag):
                ref = f"todocal-api:{tag}"
                if image(ref)["id"] not in keep:
                    command("docker", "image", "rm", ref)
    except (subprocess.SubprocessError, ValueError, KeyError):
        log("Old API image cleanup incomplete; inspect disk manually.")


def download_image(digest):
    if not DIGEST.fullmatch(digest):
        raise DeploymentError("Invalid image digest")
    ref = f"{IMAGE}@{digest}"
    # Reuse a previously pulled candidate, including awaiting approval.
    try:
        loaded = image(ref)
    except subprocess.CalledProcessError:
        if shutil.disk_usage(ROOT).free < 2*1024**3:
            raise DeploymentError("Insufficient free disk space for API image")
        command("docker", "pull", "--platform", "linux/amd64", ref, timeout=300)
        loaded = image(ref)
    verify_image(loaded, digest)
    return loaded


def update(client, digest, approved=None):
    if approved and digest != approved:
        raise DeploymentError("Approval must match the current tested digest exactly")
    current = preflight()
    if not ready(wait=30):
        raise DeploymentError("Current API is not ready; recover it before deploying")
    if f"{IMAGE}@{digest}" in current["digests"]:
        verify_image(current, digest)
        log("API already at tested digest.")
        return 0
    loaded = download_image(digest)
    if client.latest() != digest:
        raise DeploymentError("Tested digest changed during pull; retry")
    if preflight()["id"] != current["id"]:
        raise DeploymentError("Current API changed during pull")
    if loaded["id"] == current["id"]:
        log("API already at tested digest.")
        return 0
    same = compatible(current, loaded)
    if not same and not approved:
        log(f'Manual approval required for unknown or changed migration fingerprint: {digest}')
        return 3
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
    prune_old({loaded["id"], current["id"]})
    log(f"API deployment successful: {digest}")
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
    mode.add_argument("--deploy", metavar="DIGEST")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--approve", metavar="DIGEST")
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
        import blueGreen
        blue = blueGreen.enabled(sys.modules[__name__])
        if args.resume:
            if blue:
                blueGreen.preflight(sys.modules[__name__])
            else:
                if not ready(wait=30):
                    raise DeploymentError("Resolve API readiness before clearing hold")
                preflight()
            clear_hold()
            log("Deployment hold cleared. Trigger a new GitHub Actions deployment explicitly.")
            return
        if args.rollback:
            # Even on a failed deployment, this only allows equal known schemas.
            if blue:
                blueGreen.rollback(sys.modules[__name__])
            else:
                rollback()
            return
        if HOLD.exists() and not args.check:
            if args.approve or args.deploy:
                raise DeploymentError("Deployment on hold; investigate before --resume")
            log("Deployment on hold; operator action required.")
            return
        client = Registry()
        digest = client.latest()
        if args.check:
            log(f"Public GHCR tested digest: {digest}")
            return
        expected = args.deploy or args.approve
        if not DIGEST.fullmatch(expected) or digest != expected:
            raise DeploymentError("Requested digest is not the exact current tested image")
        if blue:
            return blueGreen.update(sys.modules[__name__], client, digest, args.approve)
        return update(client, digest, args.approve)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except DeploymentError as exc:
        log(str(exc))
        sys.exit(1)
    except HTTPError as exc:
        log(f"GHCR HTTP error: {exc.code}")
        sys.exit(1)
    except (URLError, OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        # Avoid printing raw HTTP or Docker credential data.
        log(f"Deployment operation failed: {type(exc).__name__}")
        sys.exit(1)
