"""Bounded signed deployment messages; no external dependencies."""
import hashlib
import hmac
import json
import re
import time

ID = re.compile(r"[0-9a-f]{32}")
TAG = re.compile(r"api-[0-9a-f]{40}")
SECRET = re.compile(r"[0-9a-f]{64}")
LIMIT = 1024


def signature(secret, body):
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def validate(secret, body, supplied, now=None):
    if not SECRET.fullmatch(secret) or not isinstance(supplied, str):
        raise ValueError("Invalid signature")
    if len(body) > LIMIT or not hmac.compare_digest(signature(secret, body), supplied):
        raise ValueError("Invalid signature")
    data = json.loads(body)
    now = time.time() if now is None else now
    if (not isinstance(data, dict) or set(data) != {"action", "id", "tag", "ts"}
            or data["action"] not in ("deploy", "status")
            or not isinstance(data["id"], str) or not ID.fullmatch(data["id"])
            or not isinstance(data["tag"], str) or not TAG.fullmatch(data["tag"])
            or type(data["ts"]) is not int or abs(now-data["ts"]) > 120):
        raise ValueError("Invalid request")
    return data
