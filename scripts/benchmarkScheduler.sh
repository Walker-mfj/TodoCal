#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Use only this project's disposable benchmark DB, never DATABASE_URL.
docker compose up -d --wait
pg_address=$(docker compose port postgres 5432)
if ! docker compose exec -T postgres psql -U focus -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='focus_scheduler_bench_test'" | grep -qx 1; then
  docker compose exec -T postgres createdb -U focus focus_scheduler_bench_test
fi
cd apps/api
SCHEDULER_BENCHMARK_DATABASE_URL="postgres://focus:focus_local_only@$pg_address/focus_scheduler_bench_test?sslmode=disable" \
  go test ./internal/services -run '^$' -bench '^BenchmarkNotificationSchedule$' -benchtime=10x -count=1 -v
