"""Blue-green replacement on one Lightsail host, using a stable Nginx proxy."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

from githubRelease import DeploymentError

SLOTS = ("blue", "green")
LOCK_TARGET = "/run/todocal-scheduler"
LOCK_FILE = LOCK_TARGET + "/leader.lock"


def enabled(ops):
    marker = ops.ROOT / "bluegreen.enabled"
    if not marker.exists():
        return False
    if marker.stat().st_uid != 0 or marker.stat().st_mode & 0o077:
        raise DeploymentError("bluegreen.enabled must be root-owned and private")
    return True


def slot_service(slot):
    if slot not in SLOTS:
        raise DeploymentError("Invalid API slot")
    return "api-" + slot


def slot_image(slot):
    slot_service(slot)
    return "todocal-api:" + slot


def other(slot):
    return "green" if slot == "blue" else "blue"


def compose(ops, *args, **kwargs):
    return ops.compose("--profile", "bluegreen", *args, **kwargs)


def render(slot):
    service = slot_service(slot)
    return f"""server {{
    listen 10000;
    location = /__slot {{ default_type text/plain; return 200 "{slot}"; }}
    location / {{
        set $todocal_backend {service}:10000;
        proxy_pass http://$todocal_backend;
    }}
}}
"""


def active_file(ops):
    return ops.ROOT / "nginx" / "active" / "active.conf"


def atomic_config(ops, slot):
    path = active_file(ops)
    fd, name = tempfile.mkstemp(dir=path.parent)
    with os.fdopen(fd, "w") as out:
        out.write(render(slot))
        out.flush()
        os.fchmod(out.fileno(), 0o644)
        os.fsync(out.fileno())
    os.replace(name, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def active_config(ops):
    data = active_file(ops).read_text()
    for slot in SLOTS:
        if data == render(slot):
            return slot
    raise DeploymentError("Unrecognized active Nginx config; investigate")


def proxy_slot(ops):
    result = compose(ops, "exec", "-T", "api", "wget", "-q", "-T", "5", "-O", "-",
                     "http://127.0.0.1:10000/__slot", capture=True, timeout=8)
    if result not in SLOTS:
        raise DeploymentError("Proxy slot is unknown")
    return result


def running(ops, slot):
    return compose(ops, "ps", "--status", "running", "--quiet", slot_service(slot),
                   capture=True).splitlines()


def ready(ops, service, wait=90):
    deadline = time.monotonic()+wait
    successes = 0
    while time.monotonic() < deadline:
        try:
            body = compose(ops, "exec", "-T", service, "wget", "-q", "-T", "5", "-O", "-",
                           "http://127.0.0.1:10000/readyz", capture=True, timeout=8)
            successes = successes+1 if json.loads(body).get("status") == "ready" else 0
            if successes == 3:
                return True
        except (subprocess.SubprocessError, ValueError, AttributeError):
            successes = 0
        time.sleep(2)
    return False


def verify_slots(ops):
    # Compose config contains secrets: capture, do not print.
    services = json.loads(compose(ops, "config", "--format", "json", capture=True))["services"]
    proxy = services["api"]
    if proxy.get("ports") or not proxy.get("image", "").startswith("nginx:"):
        raise DeploymentError("api must be a private Nginx proxy")
    for slot in SLOTS:
        spec = services[slot_service(slot)]
        if (spec.get("image") != slot_image(slot) or spec.get("ports") or spec.get("build")
                or spec.get("scale", 1) != 1 or spec.get("deploy", {}).get("replicas", 1) != 1):
            raise DeploymentError("Invalid API slot configuration")
        env = spec.get("environment", {})
        if env.get("SCHEDULER_LOCK_PATH") != LOCK_FILE or env.get("SKIP_STARTUP_MIGRATIONS") != "true":
            raise DeploymentError("Slot must share scheduler lock and disable startup migrations")
        mounts = [v for v in spec.get("volumes", []) if v.get("target") == LOCK_TARGET]
        if (len(mounts) != 1 or mounts[0].get("source") != str(ops.ROOT / "scheduler-lock")
                or not mounts[0].get("read_only") or mounts[0].get("type") != "bind"):
            raise DeploymentError("Both slots must bind the same read-only local lock directory")
    lock = ops.ROOT / "scheduler-lock" / "leader.lock"
    if not lock.is_file() or lock.is_symlink():
        raise DeploymentError("Shared local scheduler lock is missing")


def active_image(ops, slot):
    ids = running(ops, slot)
    if len(ids) != 1:
        raise DeploymentError("Expected exactly one running container for active slot")
    info = json.loads(ops.command("docker", "inspect", ids[0], capture=True))[0]
    mount = [m for m in info["Mounts"] if m["Destination"] == LOCK_TARGET]
    env = info["Config"]["Env"]
    if (len(mount) != 1 or mount[0]["Source"] != str(ops.ROOT / "scheduler-lock") or mount[0]["RW"]
            or "SCHEDULER_LOCK_PATH="+LOCK_FILE not in env or "SKIP_STARTUP_MIGRATIONS=true" not in env):
        raise DeploymentError("Running slot does not match scheduler fencing contract")
    image = ops.image(info["Image"])
    if image["leader"] != "v1" or image["id"] != ops.image(slot_image(slot))["id"]:
        raise DeploymentError("Active slot lacks compatible leader support or stable image tag")
    return image


def preflight(ops):
    verify_slots(ops)
    slot = active_config(ops)
    if proxy_slot(ops) != slot or running(ops, other(slot)):
        raise DeploymentError("Ambiguous proxy/slot state; recover manually")
    current = active_image(ops, slot)
    if not ready(ops, "api", wait=30):
        raise DeploymentError("Current proxy is not ready")
    return slot, current


def stop(ops, slot):
    compose(ops, "stop", slot_service(slot), timeout=120)
    if running(ops, slot):
        raise DeploymentError("Slot failed to stop completely")


def start(ops, slot, ref):
    ops.command("docker", "tag", ref, slot_image(slot))
    compose(ops, "up", "-d", "--no-deps", "--force-recreate", "--pull", "never",
            slot_service(slot), timeout=120)
    if active_image(ops, slot)["id"] != ops.image(ref)["id"] or not ready(ops, slot_service(slot)):
        raise DeploymentError("Candidate slot is not ready")


def workers(ops):
    ps = compose(ops, "exec", "-T", "api", "ps", "-o", "pid,args", capture=True)
    return {line.split()[0] for line in ps.splitlines()
            if re.match(r"^\s*\d+\s+nginx: worker process", line)}


def switch(ops, target):
    previous = active_config(ops)
    old_workers = workers(ops)
    if not old_workers:
        raise DeploymentError("Cannot identify Nginx workers to drain")
    atomic_config(ops, target)
    try:
        compose(ops, "exec", "-T", "api", "nginx", "-t")
    except subprocess.SubprocessError:
        atomic_config(ops, previous)
        raise
    compose(ops, "exec", "-T", "api", "nginx", "-s", "reload")
    # The reload command exits before old workers finish. Verify the new
    # route, then wait until every pre-reload worker has exited.
    deadline = time.monotonic()+65
    while time.monotonic() < deadline:
        try:
            if proxy_slot(ops) == target and not (workers(ops) & old_workers):
                if ready(ops, "api", wait=15):
                    return
        except (DeploymentError, subprocess.SubprocessError):
            pass
        time.sleep(2)
    raise DeploymentError("Nginx switch/drain could not be verified; keep both slots running")


def memory_guard():
    meminfo = Path("/proc/meminfo").read_text()
    available = re.search(r"^MemAvailable:\s+(\d+)\s+kB", meminfo, re.M)
    if not available or int(available.group(1)) < 640*1024:
        raise DeploymentError("Need at least 640 MiB available RAM before overlapping APIs")


def handoff(ops, slot, current, target, loaded, compatible, keep_hold=False):
    if loaded["leader"] != "v1":
        raise DeploymentError("Candidate lacks shared-host leader support")
    if compatible:
        memory_guard()
    ops.write_hold("blue-green deployment in progress", current["id"], loaded["id"])
    proxy_switch_started = False
    migration_started = False
    try:
        if not compatible:
            # Approved schema changes are intentionally offline. The old
            # API/scheduler is stopped before backup and explicit migration.
            stop(ops, slot)
            ops.command(str(ops.ROOT / "backup.sh"), "frequent", timeout=1800)
            ops.command("docker", "tag", loaded["id"], slot_image(target))
            migration_started = True
            compose(ops, "run", "--rm", "--no-deps", "--entrypoint",
                    "/usr/local/bin/todocal-api", slot_service(target), "-migrate", timeout=180)
        start(ops, target, loaded["id"])
        proxy_switch_started = True
        switch(ops, target)
        if compatible:
            stop(ops, slot)
        if not ready(ops, "api", wait=30):
            raise DeploymentError("Proxy readiness failed after handoff")
    except (DeploymentError, OSError, subprocess.SubprocessError) as exc:
        if compatible and not proxy_switch_started:
            # Old route never changed; failed candidate must be stopped.
            try:
                stop(ops, target)
            except (DeploymentError, subprocess.SubprocessError, OSError):
                ops.log("Candidate cleanup failed; inspect both slots.")
        elif not compatible and not migration_started:
            try:
                start(ops, slot, current["id"])
            except (DeploymentError, subprocess.SubprocessError, OSError):
                ops.log("Old slot recovery failed; inspect host.")
        # Ambiguous reload: never stop an instance that may still serve
        # traffic. After a possible migration never restart an old binary.
        ops.log("Deployment on hold; inspect active.conf, proxy and slots.")
        raise DeploymentError("Blue-green handoff failed; manual recovery required") from exc
    if not keep_hold:
        ops.clear_hold()
        ops.prune_old({current["sha"], loaded["sha"]})
    ops.log(f"API active slot: {target}; revision: {loaded['sha']}")


def update(ops, client, release, approved=None):
    slot, current = preflight(ops)
    if current["sha"] == release["sha"]:
        ops.log("API already at latest release.")
        return 0
    same = ops.compatible(current, release)
    if not same and not approved:
        ops.log(f'Manual approval required for migration change: {release["tag"]}')
        return 3
    if approved and approved != release["tag"]:
        raise DeploymentError("Approval does not match exact release")
    loaded = ops.download_image(client, release)
    if client.latest() != release or preflight(ops) != (slot, current):
        raise DeploymentError("Release or active slot changed during download")
    handoff(ops, slot, current, other(slot), loaded, same)
    return 0


def rollback(ops):
    slot, current = preflight(ops)
    previous = ops.image(slot_image(other(slot)))
    if current["id"] == previous["id"] or not ops.compatible(current, previous):
        raise DeploymentError("Rollback requires a different compatible slot image")
    handoff(ops, slot, current, other(slot), previous, True, keep_hold=True)
    ops.log("Rollback completed; deployment remains on hold.")
