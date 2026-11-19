"""Read-only GitHub App release client. No third-party Python packages."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.parse import urlsplit

API = "https://api.github.com"
TAG = re.compile(r"api-([0-9a-f]{40})")
ASSET = re.compile(r"todocal-api-([0-9a-f]{64})\.tar\.gz")
DIGEST = re.compile(r"sha256:([0-9a-f]{64})")
MAX_ASSET = 2 * 1024**3 - 1
REPO = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")


class DeploymentError(Exception):
    pass


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=")


def jwt(app_id, private_key, now=None):
    now = int(time.time()) if now is None else now
    unsigned = b".".join((
        b64(b'{"alg":"RS256","typ":"JWT"}'),
        b64(json.dumps({"iat": now - 60, "exp": now + 540, "iss": app_id}).encode()),
    ))
    signature = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", str(private_key)],
        input=unsigned, stdout=subprocess.PIPE, check=True, timeout=10,
    ).stdout
    return (unsigned + b"." + b64(signature)).decode()


class SecureRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        # Only signed HTTPS release download redirects. Authorization is an
        # unredirected header and must never accompany the signed URL.
        if (req.get_method() != "GET" or target.scheme != "https"
                or target.username or target.password
                or not (target.hostname == "githubusercontent.com"
                        or (target.hostname or "").endswith(".githubusercontent.com"))):
            raise DeploymentError("Unexpected GitHub redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = build_opener(SecureRedirect())


def request(path, token, accept="application/vnd.github+json", payload=None):
    if not path.startswith("/") or path.startswith("//"):
        raise DeploymentError("Invalid GitHub API path")
    req = Request(API + path, data=None if payload is None else json.dumps(payload).encode(),
                  headers={"Accept": accept, "X-GitHub-Api-Version": "2022-11-28",
                           "Content-Type": "application/json", "User-Agent": "TodoCal-deployer"})
    req.add_unredirected_header("Authorization", f"Bearer {token}")
    return OPENER.open(req, timeout=60)


def read_json(path, token, payload=None):
    with request(path, token, payload=payload) as response:
        return json.load(response)


def parse_release(release):
    if release.get("draft") or release.get("prerelease"):
        raise DeploymentError("Latest release is not a stable API release")
    tag = TAG.fullmatch(release.get("tag_name", ""))
    if not tag:
        raise DeploymentError("Latest release is not a TodoCal API release")
    assets = release.get("assets", [])
    if len(assets) != 1:
        raise DeploymentError("API release must have exactly one image asset")
    asset = assets[0]
    name = ASSET.fullmatch(asset.get("name", ""))
    digest = DIGEST.fullmatch(asset.get("digest") or "")
    size = asset.get("size")
    asset_id = asset.get("id")
    if (not name or not digest or type(size) is not int or not 0 < size <= MAX_ASSET
            or type(asset_id) is not int or asset_id <= 0 or asset.get("state") != "uploaded"):
        raise DeploymentError("Invalid or incomplete API asset metadata")
    return {"tag": tag.group(0), "sha": tag.group(1), "fingerprint": name.group(1),
            "digest": digest.group(1), "size": size, "id": asset_id}


class Client:
    def __init__(self, env):
        repo = env["GITHUB_REPOSITORY"]
        self.repo = repo
        if not REPO.fullmatch(repo):
            raise DeploymentError("Invalid repository")
        app_id = env["GITHUB_APP_ID"]
        installation = env["GITHUB_INSTALLATION_ID"]
        if not app_id.isdigit() or not installation.isdigit():
            raise DeploymentError("Invalid GitHub App ID or installation ID")
        key = Path(env["GITHUB_PRIVATE_KEY_PATH"])
        if not key.is_file() or key.stat().st_uid != os.geteuid() or key.stat().st_mode & 0o077:
            raise DeploymentError("Private key must be owned by the deploy user and private")
        # Scope the token to just this repository and read-only contents.
        self.token = read_json(
            f"/app/installations/{installation}/access_tokens", jwt(app_id, key),
            {"repositories": [repo.split("/")[1]], "permissions": {"contents": "read"}},
        )["token"]
        self.path = f"/repos/{repo}"

    def latest(self):
        try:
            data = read_json(self.path + "/releases/latest", self.token)
        except HTTPError as exc:
            if exc.code != 404:
                raise
            # Distinguish no release from no repository access.
            read_json(self.path, self.token)
            return None
        return parse_release(data)

    def download(self, release, destination):
        digest = hashlib.sha256()
        count = 0
        path = self.path + f'/releases/assets/{release["id"]}'
        with request(path, self.token, "application/octet-stream") as response:
            with destination.open("xb") as out:
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    count += len(block)
                    if count > release["size"]:
                        raise DeploymentError("Image exceeds advertised size")
                    digest.update(block)
                    out.write(block)
        if count != release["size"] or digest.hexdigest() != release["digest"]:
            raise DeploymentError("Image size or SHA-256 mismatch")
