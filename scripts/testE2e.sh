#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# This run owns exactly one database; never remove the shared Postgres volume.
e2e_db="focus_web_test_$(node -p "require('node:crypto').randomBytes(12).toString('hex')")"
db_created=false
api_pid=''
web_pid=''
stop_server() {
  server_pid=$1
  if [ -z "$server_pid" ]; then return; fi
  kill "$server_pid" 2>/dev/null || true
  stop_attempt=0
  while kill -0 "$server_pid" 2>/dev/null; do
    stop_attempt=$((stop_attempt + 1))
    if [ "$stop_attempt" -ge 5 ]; then
      kill -KILL "$server_pid" 2>/dev/null || true
      break
    fi
    sleep 1
  done
  wait "$server_pid" 2>/dev/null || true
}
cleanup() {
  run_status=$?
  trap - EXIT
  trap '' INT TERM
  stop_server "$web_pid"
  stop_server "$api_pid"
  if [ "$db_created" = true ]; then
    if ! docker compose exec -T postgres dropdb -U focus --if-exists --force "$e2e_db"; then
      echo "Failed to clean up E2E database: $e2e_db" >&2
      if [ "$run_status" -eq 0 ]; then run_status=1; fi
    fi
  fi
  exit "$run_status"
}
# Install before database creation/build/migration so failures also clean up.
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker compose up -d --wait
pg_address=$(docker compose port postgres 5432)
docker compose exec -T postgres createdb -U focus "$e2e_db"
db_created=true
echo "E2E database: $e2e_db"
mkdir -p .local
(cd apps/api && go build -o ../../.local/focus-api-e2e ./cmd/api)
export DATABASE_URL="postgres://focus:focus_local_only@$pg_address/$e2e_db?sslmode=disable"
export API_ADDR=127.0.0.1:18080 APP_ORIGIN=http://127.0.0.1:3002 COOKIE_SECURE=false
export API_URL=http://127.0.0.1:18080 E2E_BASE_URL=http://127.0.0.1:3002
. ./scripts/e2ePushEnv.sh
.local/focus-api-e2e -migrate
(cd apps/web && npm run build)
.local/focus-api-e2e > .local/e2e-api.log 2>&1 &
api_pid=$!
node apps/web/node_modules/next/dist/bin/next start apps/web --hostname 127.0.0.1 --port 3002 > .local/e2e-web.log 2>&1 &
web_pid=$!
attempt=0
until curl -fsS "$API_URL/readyz" >/dev/null 2>&1 && curl -fsS "$E2E_BASE_URL" >/dev/null 2>&1; do
  attempt=$((attempt+1))
  if [ "$attempt" -ge 30 ] || ! kill -0 "$api_pid" 2>/dev/null || ! kill -0 "$web_pid" 2>/dev/null; then
    cat .local/e2e-api.log .local/e2e-web.log
    exit 1
  fi
  sleep 1
done
# Each browser project gets fresh rate-limit counters in the dedicated test DB.
# This preserves production rate limiting while repeated local suites remain deterministic.
reset_test_limits() {
  docker compose exec -T postgres psql -U focus -d "$e2e_db" -v ON_ERROR_STOP=1 -c 'TRUNCATE auth_attempts' >/dev/null
}
run_browser_tests() {
  if [ -n "${E2E_PLAYWRIGHT_IMAGE:-}" ]; then
    echo "Running Playwright in prebuilt image: $E2E_PLAYWRIGHT_IMAGE"
    # GitHub's Linux host network lets the container reach 127.0.0.1 test servers.
    docker run --rm --init --ipc=host --network=host \
      --volume "$PWD:/workspace" --workdir /workspace/apps/web \
      --env E2E_BASE_URL="$E2E_BASE_URL" --env API_URL="$API_URL" \
      --env CI="${CI:-true}" \
      "$E2E_PLAYWRIGHT_IMAGE" npm run test:e2e -- "$@"
  else
    (cd apps/web && npm run test:e2e -- "$@")
  fi
}
if [ "$#" -eq 0 ]; then
  for browser_project in chromium firefox webkit; do
    reset_test_limits
    run_browser_tests --project="$browser_project"
  done
else
  reset_test_limits
  run_browser_tests "$@"
fi
