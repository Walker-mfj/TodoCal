"""Add the owner-provisioned deployment VPC ID only for this deployment."""
import json
import os
from pathlib import Path
import re

service = os.getenv("DEPLOY_VPC_SERVICE_ID", "")
if service:
    if not re.fullmatch(r"[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}", service):
        raise SystemExit("Invalid DEPLOY_VPC_SERVICE_ID")
    path = Path(__file__).with_name("wrangler.jsonc")
    config = json.loads(path.read_text())
    bindings = config["vpc_services"]
    if any(b["service_id"].lower() == service.lower() for b in bindings):
        raise SystemExit("Deployment VPC service must be separate from API")
    bindings.append({"binding": "TODOCAL_DEPLOY", "service_id": service, "remote": True})
    path.write_text(json.dumps(config, indent=2) + "\n")
