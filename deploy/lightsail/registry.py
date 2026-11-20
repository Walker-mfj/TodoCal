"""Resolve the fixed public GHCR tested image, without installed credentials."""
import hashlib
import json
import re
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

IMAGE = "ghcr.io/walker-mfj/todocal-api"
REPO = "walker-mfj/todocal-api"
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
ACCEPT = ", ".join((
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
))
LIMIT = 2*1024*1024


class DeploymentError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def read(request):
    with build_opener(NoRedirect()).open(request, timeout=20) as response:
        body = response.read(LIMIT+1)
        if len(body) > LIMIT:
            raise DeploymentError("Oversized GHCR response")
        return body, response.headers


class Registry:
    def latest(self):
        query = urlencode({"service": "ghcr.io", "scope": f"repository:{REPO}:pull"})
        body, _ = read(Request("https://ghcr.io/token?"+query))
        token = json.loads(body)["token"]
        if not isinstance(token, str) or not token:
            raise DeploymentError("GHCR anonymous pull token missing")
        body, headers = read(Request(f"https://ghcr.io/v2/{REPO}/manifests/tested",
                                     headers={"Authorization": f"Bearer {token}", "Accept": ACCEPT}))
        digest = headers.get("Docker-Content-Digest", "")
        if not DIGEST.fullmatch(digest) or digest != "sha256:"+hashlib.sha256(body).hexdigest():
            raise DeploymentError("GHCR tested manifest digest mismatch")
        if headers.get("Content-Type", "").split(";")[0].strip() not in ACCEPT.split(", "):
            raise DeploymentError("Unsupported GHCR manifest media type")
        return digest
