"""Temporary read-only probes for Workers VPC error 10196; safe for public logs."""
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

BASE = "https://api.cloudflare.com/client/v4"
MAX_BODY = 2 * 1024 * 1024
ACCOUNT = re.compile(r"[0-9a-fA-F]{32}")
SERVICE = re.compile(r"[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}")


class NoRedirect(HTTPRedirectHandler):
    # Never send bearer credentials to another URL.
    def redirect_request(self, *args, **kwargs):
        return None


def inspect_response(status, raw, verify=False):
    # Never print HTTP response bodies, headers, error messages, IDs or tokens.
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeError):
        return f"HTTP {status}; response=unparseable"
    if not isinstance(data, dict):
        return f"HTTP {status}; response=unexpected"
    success = data.get("success")
    outcome = "true" if success is True else "false" if success is False else "unknown"
    errors = data.get("errors")
    codes = []
    if isinstance(errors, list):
        codes = [str(e["code"]) for e in errors[:20]
                 if isinstance(e, dict) and type(e.get("code")) is int
                 and 0 <= e["code"] <= 999999999]
    line = f"HTTP {status}; success={outcome}; error_codes={','.join(codes) or 'none'}"
    if verify:
        result = data.get("result")
        state = result.get("status") if isinstance(result, dict) else None
        line += "; token_status=" + (state if state in ("active", "disabled", "expired") else "unknown")
    return line


def probe(label, path, token, verify=False):
    request = Request(BASE + path, method="GET", headers={
        "Authorization": "Bearer " + token, "Accept": "application/json"
    })
    try:
        try:
            response = build_opener(NoRedirect()).open(request, timeout=12)
        except HTTPError as exc:
            response = exc
        with response:
            status = response.code
            raw = response.read(MAX_BODY + 1)
        line = (f"HTTP {status}; response=too-large" if len(raw) > MAX_BODY
                else inspect_response(status, raw, verify))
    except (URLError, OSError, ValueError):
        # Exception text can contain arbitrary data; do not display it.
        line = "request failed (network/timeout/invalid response)"
    print(f"{label}: {line}", flush=True)


def probes(account, config):
    if not ACCOUNT.fullmatch(account) or config.get("name") != "todocal":
        raise ValueError("Invalid account or worker configuration")
    account_path = "/accounts/" + account
    worker = account_path + "/workers/scripts/todocal"
    directory = account_path + "/connectivity/directory/services"
    yield "Account API token verify", account_path + "/tokens/verify", True
    yield "User API token verify", "/user/tokens/verify", True
    yield "Worker settings", worker + "/settings", False
    yield "Worker script settings", worker + "/script-settings", False
    yield "List VPC services", directory, False
    entries = config.get("vpc_services", [])
    for name in ("TODOCAL_API", "TODOCAL_DEPLOY"):
        matches = [x.get("service_id") for x in entries if x.get("binding") == name]
        if len(matches) != 1 or not isinstance(matches[0], str) or not SERVICE.fullmatch(matches[0]):
            print(f"{name}: missing or invalid configured service ID", flush=True)
            continue
        yield name, directory + "/" + matches[0], False


def main():
    token = os.getenv("CLOUDFLARE_API_TOKEN", "")
    if not token:
        print("Diagnostic skipped: missing API token")
        return
    try:
        config = json.loads(Path(__file__).with_name("wrangler.jsonc").read_text())
        checks = list(probes(os.getenv("CLOUDFLARE_ACCOUNT_ID", ""), config))
    except (OSError, ValueError, TypeError, AttributeError):
        print("Diagnostic skipped: invalid local configuration")
        return
    for label, path, verify in checks:
        probe(label, path, token, verify)
    print("Read-only diagnostics do not prove Bind permission. One token verification endpoint may fail normally.")


if __name__ == "__main__":
    main()
