# Retire legacy Render and Neon (operator checklist)

The owner has migrated production to Lightsail. This is a gated retirement runbook, not an automated deletion job or proof that remote resources are already removed. Removing render.yaml or the public fallback from Git does not delete any cloud service. Do not reconnect the old scheduler or permit old database writes.

## Before deleting anything

- Verify latest main CI, frontend and backend deployment succeed; confirm the Worker is in vpc mode, both bindings are present and authenticated application smoke tests pass. Inspect the active Nginx slot and revision on Lightsail. Confirm all readiness monitors are on the new endpoint and the active deployment receiver and backup timers are healthy.
- On Lightsail inspect the active API's DATABASE_URL privately and confirm its hostname resolves to the local PostgreSQL service, not Neon. Check all production consumers, CI secrets/variables, old Worker versions/origins, integrations, development/staging and backup jobs for legacy dependencies. Keep the old API and scheduler fenced, with auto-deploy disabled; do not start them to test.
- Verify the recent Lightsail S3 backup (checksum, successful heartbeat/upload and a real restore into an isolated database). Verify schema, data counts and application smoke tests in isolation without enabling push or scheduler. Retain an encrypted final consistent legacy Neon backup with checksum and a verified isolated restore; it is historical, not the latest production data. Retain backups per the owner's recovery policy.
- Check Render's service, associated resources and Neon project/branches; confirm no other projects or applications share them. Record resource IDs and evidence privately. No secret values in logs or Git.

## Retire in order, after approval of the checks

1. Once the VPC-only Worker is live, remove the obsolete Worker API_ORIGIN setting; do not remove API_BACKEND, PROXY_SECRET, DEPLOY_TRIGGER_SECRET, or either VPC binding.
2. Delete the dedicated inactive Render service and only its unused resources/credentials. Do not remove shared workspace integrations. Verify the live app, readiness and monitoring again.
3. After the recovery window and explicit confirmation of both restore checks and no remaining consumers, delete only the dedicated old Neon project/branch(s). Revoke unused credentials and remove old monitor/CI/provider links. Never delete the Lightsail PostgreSQL volume, S3 backup bucket, backup timers or HMAC key.
4. Record date, resource IDs, backup/restore evidence, and the verified production revision. If any gate fails, leave the old resources fenced and investigate. Recovery must preserve newer production writes; no blind switch back to the old database.

Live host configuration, backup objects, restore evidence and provider deletion state were not verified by this repository change. Do not treat merge as approval for deletion.
