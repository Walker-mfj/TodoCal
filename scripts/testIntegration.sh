#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Deliberately ignore DATABASE_URL: test reset operations must never target app data.
docker compose up -d --wait
if ! docker compose exec -T postgres psql -U focus -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='focus_test'" | grep -qx 1; then
  docker compose exec -T postgres createdb -U focus focus_test
fi
cd apps/api
TEST_DATABASE_URL='postgres://focus:focus_local_only@localhost:55432/focus_test?sslmode=disable' go test -race -count=1 ./...
