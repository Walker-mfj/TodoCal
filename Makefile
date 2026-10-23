SHELL := /bin/sh
.DEFAULT_GOAL := help
-include .env
export
DATABASE_URL ?= postgres://focus:focus_local_only@localhost:55432/focus?sslmode=disable
APP_ORIGIN ?= http://localhost:3000
API_ADDR ?= 127.0.0.1:8080

.PHONY: help db-up migrate api-dev test-go test-integration build-api
help:
	@echo 'Commands: db-up migrate api-dev worker-dev worker-once test-go test-integration build-api build-worker web-dev typecheck test-web build-web test-e2e'
db-up:
	docker compose up -d --wait
migrate:
	cd apps/api && go run ./cmd/api -migrate
api-dev:
	cd apps/api && go run ./cmd/api
test-go:
	cd apps/api && TEST_DATABASE_URL= go test -race -count=1 ./...
test-integration:
	sh scripts/test-integration.sh
build-api:
	mkdir -p .local
	cd apps/api && go build -o ../../.local/focus-api ./cmd/api

.PHONY: worker-dev worker-once build-worker
worker-dev:
	cd apps/api && go run ./cmd/worker
worker-once:
	cd apps/api && go run ./cmd/worker -once
build-worker:
	mkdir -p .local
	cd apps/api && go build -o ../../.local/focus-worker ./cmd/worker

.PHONY: web-dev typecheck test-web build-web generate-api-types
web-dev:
	cd apps/web && npm run dev
typecheck:
	cd apps/web && npm run typecheck
test-web:
	cd apps/web && npm test
build-web:
	cd apps/web && npm run build
generate-api-types:
	cd apps/web && npm run generate:api

.PHONY: test-e2e
test-e2e:
	sh scripts/test-e2e.sh $(E2E_ARGS)

.PHONY: test-operations
test-operations: build-api
	python3 scripts/test-operations.py
