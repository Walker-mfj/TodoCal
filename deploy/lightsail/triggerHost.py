"""Root Unix-socket gate and durable event journal. Never listens on TCP."""
import base64
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from triggerProtocol import ID, DIGEST, validate

ROOT = Path("/opt/todocal")
STATE = ROOT / "deploy-events"
KEY = ROOT / "secrets/trigger.key"


def store(path, record):
    fd, name = tempfile.mkstemp(dir=STATE)
    with os.fdopen(fd, "w") as out:
        json.dump(record, out)
        out.flush()
        os.fsync(out.fileno())
    os.replace(name, path)
    fd = os.open(STATE, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def record_path(request_id):
    if not ID.fullmatch(request_id):
        raise ValueError("Invalid request ID")
    return STATE / (request_id + ".json")


def dispatch(data):
    path = record_path(data["id"])
    with (STATE / "gate.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if path.exists():
            record = json.loads(path.read_text())
            if record["digest"] != data["digest"]:
                return 409, "unavailable"
            return 200, record["status"]
        if data["action"] == "status":
            return 200, "unknown"
        # Bound disk growth. Retain terminal records for at least seven days,
        # far beyond the signed replay window. Unresolved records require review.
        for file in STATE.glob("*.json"):
            if time.time() - file.stat().st_mtime > 7*86400:
                if json.loads(file.read_text())["status"] in ("succeeded", "failed", "needs_approval"):
                    file.unlink()
        if sum(1 for _ in STATE.glob("*.json")) >= 1000:
            return 503, "unavailable"
        record = {"digest": data["digest"], "status": "queued"}
        store(path, record)
        try:
            subprocess.run(["systemctl", "start", "--no-block",
                            f'todocal-deploy-job@{data["id"]}.service'],
                           check=True, timeout=4, stdout=subprocess.DEVNULL)
        except (OSError, subprocess.SubprocessError):
            store(path, record | {"status": "failed"})
            return 200, "failed"
        return 200, "queued"


def receive():
    try:
        if KEY.stat().st_uid != 0 or KEY.stat().st_mode & 0o077:
            raise ValueError("Insecure secret")
        envelope = json.loads(sys.stdin.buffer.readline(2048))
        body = base64.b64decode(envelope["body"], validate=True)
        data = validate(KEY.read_text().strip(), body, envelope["signature"])
        code, status = dispatch(data)
    except (ValueError, KeyError, TypeError):
        code, status = 401, "unavailable"
    except OSError:
        code, status = 503, "unavailable"
    print(json.dumps({"code": code, "status": status}), flush=True)


def job(request_id):
    path = record_path(request_id)
    with (STATE / "gate.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        record = json.loads(path.read_text())
        if record["status"] != "queued" or not DIGEST.fullmatch(record["digest"]):
            return
        store(path, record | {"status": "running"})
    result = "failed"
    # Contention with another event or a manual operation is retryable.
    # Each attempt revalidates the exact latest release under deploy.py's
    # existing exclusive lock. Never retry ordinary deployment failures.
    deadline = time.monotonic() + 10*60
    try:
        while True:
            # Allow the full offline backup budget plus pull, migration and handoff.
            code = subprocess.run([sys.executable, str(ROOT / "deploy.py"), "--deploy", record["digest"]],
                                  cwd=ROOT, timeout=50*60).returncode
            if code != 75:
                result = "succeeded" if code == 0 else "failed"
                break
            if time.monotonic() >= deadline:
                break
            store(path, record | {"status": "busy"})
            time.sleep(5)
            store(path, record | {"status": "running"})
    finally:
        store(path, record | {"status": result})
    if result == "failed":
        raise SystemExit(1)


if __name__ == "__main__":
    if os.geteuid() != 0:
        raise SystemExit("Root required")
    os.umask(0o077)
    STATE.mkdir(mode=0o700, exist_ok=True)
    if len(sys.argv) == 2:
        job(sys.argv[1])
    else:
        receive()
