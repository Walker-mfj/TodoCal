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
# Render Free has no pre-deploy command; the single instance migrates on startup.
todocal-api -migrate
exec todocal-api
