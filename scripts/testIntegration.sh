#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Deliberately ignore DATABASE_URL: test reset operations must never target app data.
docker compose up -d --wait
# Resolve this project's published port so parallel worktrees can use separate volumes.
pg_address=$(docker compose port postgres 5432)
for test_database in focus_test focus_notifications_test; do
  if ! docker compose exec -T postgres psql -U focus -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$test_database'" | grep -qx 1; then
    docker compose exec -T postgres createdb -U focus "$test_database"
  fi
done
cd apps/api
# These packages reset their schema independently and may run concurrently.
TEST_DATABASE_URL="postgres://focus:focus_local_only@$pg_address/focus_test?sslmode=disable" \
NOTIFICATIONS_TEST_DATABASE_URL="postgres://focus:focus_local_only@$pg_address/focus_notifications_test?sslmode=disable" \
  go test -race -count=1 ./...
