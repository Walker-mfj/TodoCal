"""GitHub Actions sends a signed event, then checks only that event's status."""
import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, HTTPRedirectHandler, build_opener
import uuid

from triggerProtocol import SECRET, DIGEST, signature

URL = "https://todocal.digitalhome.workers.dev/api/internal/deploy"
TERMINAL = {"succeeded", "failed", "needs_approval"}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def call(secret, digest, request_id, action):
    data = json.dumps({"action": action, "id": request_id, "digest": digest,
                       "ts": int(time.time())}, separators=(",", ":")).encode()
    req = Request(URL, data=data, headers={"Content-Type": "application/json",
                  "X-TodoCal-Deploy-Signature": signature(secret, data)})
    with build_opener(NoRedirect()).open(req, timeout=15) as response:
        return json.load(response)["status"]


def main():
    secret, digest = os.environ.get("DEPLOY_TRIGGER_SECRET", ""), os.environ.get("DEPLOY_DIGEST", "")
    if not SECRET.fullmatch(secret) or not DIGEST.fullmatch(digest):
        raise SystemExit("Invalid trigger secret or API digest")
    request_id = uuid.uuid4().hex
    print(f"Deployment request {request_id}: {digest}", flush=True)
    started = False
    deadline = time.monotonic() + 45*60
    while time.monotonic() < deadline:
        try:
            status = call(secret, digest, request_id, "status" if started else "deploy")
        except HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504):
                raise SystemExit(f"Deployment endpoint HTTP {exc.code}") from None
        except (URLError, TimeoutError):
            pass
        else:
            if status == "succeeded":
                # The root deploy script confirms exact image and local readiness;
                # independently check the public Worker path.
                with build_opener(NoRedirect()).open(
                    "https://todocal.digitalhome.workers.dev/api/readyz", timeout=15
                ) as response:
                    if response.status != 200 or json.load(response).get("status") != "ready":
                        raise SystemExit("Public readiness failed")
                print("Deployment succeeded")
                return
            if status in TERMINAL:
                raise SystemExit(f"Deployment {status}: {digest}; inspect host journal and runbook")
            if status in ("queued", "running", "busy"):
                started = True
            elif status != "unknown":
                raise SystemExit(f"Unexpected deployment status: {status}")
            elif started:
                raise SystemExit("Previously accepted deployment record disappeared")
        time.sleep(10)
    raise SystemExit("Deployment result timed out; inspect durable request status on Lightsail")


if __name__ == "__main__":
    main()
