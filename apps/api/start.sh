#!/bin/sh
set -eu
: "${DATABASE_URL:?Set DATABASE_URL}"
: "${APP_ORIGIN:?Set APP_ORIGIN}"
: "${PROXY_SECRET:?Set PROXY_SECRET to the same secret as Cloudflare}"
if [ "${#PROXY_SECRET}" -lt 32 ]; then
  echo 'PROXY_SECRET must contain at least 32 characters' >&2
  exit 1
fi
export API_ADDR="0.0.0.0:${PORT:-10000}"
export COOKIE_SECURE=true
# Single-container deployments still migrate at startup. Blue-green slots
# must never run implicit schema changes while another API is serving.
case "${SKIP_STARTUP_MIGRATIONS:-false}" in
  true) : "${SCHEDULER_LOCK_PATH:?Set shared scheduler lock path}" ;;
  false) todocal-api -migrate ;;
  *) echo 'Invalid SKIP_STARTUP_MIGRATIONS' >&2; exit 1 ;;
esac
exec todocal-api
