#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Isolated browser-test database; never truncate or reset the development database.
docker compose up -d --wait
# Resolve this project's published port so parallel worktrees can use separate volumes.
pg_address=$(docker compose port postgres 5432)
if ! docker compose exec -T postgres psql -U focus -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='focus_web_test'" | grep -qx 1; then
  docker compose exec -T postgres createdb -U focus focus_web_test
fi
mkdir -p .local
(cd apps/api && go build -o ../../.local/focus-api-e2e ./cmd/api)
export DATABASE_URL="postgres://focus:focus_local_only@$pg_address/focus_web_test?sslmode=disable"
export API_ADDR=127.0.0.1:18080 APP_ORIGIN=http://127.0.0.1:3002 COOKIE_SECURE=false
export API_URL=http://127.0.0.1:18080 E2E_BASE_URL=http://127.0.0.1:3002
. ./scripts/e2ePushEnv.sh
.local/focus-api-e2e -migrate
(cd apps/web && npm run build)
api_pid=''
web_pid=''
cleanup() {
  if [ -n "$web_pid" ]; then kill "$web_pid" 2>/dev/null || true; fi
  if [ -n "$api_pid" ]; then kill "$api_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM
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
  docker compose exec -T postgres psql -U focus -d focus_web_test -v ON_ERROR_STOP=1 -c 'TRUNCATE auth_attempts' >/dev/null
}
# Opt-in CI experiment: only the browser test process runs in the official
# Playwright image. Compose, migrations, Go API and Next.js servers stay on the
# Linux runner, so the same isolated database and test endpoints are reused.
run_browser_tests() {
  if [ -n "${E2E_WEBKIT_IMAGE:-}" ]; then
    echo "Running Playwright in prebuilt image: $E2E_WEBKIT_IMAGE"
    # GitHub's Linux host network lets the container reach 127.0.0.1 test servers.
    # Keep the repository mounted so Playwright traces remain uploadable by CI.
    docker run --rm --init --ipc=host --network=host \
      --volume "$PWD:/workspace" --workdir /workspace/apps/web \
      --env E2E_BASE_URL="$E2E_BASE_URL" --env API_URL="$API_URL" \
      --env CI="${CI:-true}" \
      "$E2E_WEBKIT_IMAGE" npm run test:e2e -- "$@"
  else
    (cd apps/web && npm run test:e2e -- "$@")
  fi
}
if [ "$#" -eq 0 ]; then
  for browser_project in chrome firefox webkit; do
    reset_test_limits
    run_browser_tests --project="$browser_project"
  done
else
  reset_test_limits
  run_browser_tests "$@"
fi
