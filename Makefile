SHELL := /bin/sh
.DEFAULT_GOAL := help
-include .env
export
DATABASE_URL ?= postgres://focus:focus_local_only@localhost:55432/focus?sslmode=disable
APP_ORIGIN ?= http://localhost:3000
API_ADDR ?= 127.0.0.1:8080

.PHONY: help db-up migrate api-dev test-go test-integration build-api
help:
	@echo 'Commands: db-up migrate api-dev test-go test-integration build-api web-dev typecheck test-web build-web test-e2e lint-go format-go-check check-go-architecture check-web-architecture'
db-up:
	docker compose up -d --wait
migrate:
	cd apps/api && go run ./cmd/api -migrate
api-dev:
	cd apps/api && go run ./cmd/api
test-go:
	cd apps/api && TEST_DATABASE_URL= go test -race -count=1 ./...
test-integration:
	sh scripts/testIntegration.sh
build-api:
	mkdir -p .local
	cd apps/api && go build -o ../../.local/focus-api ./cmd/api

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
	sh scripts/testE2e.sh $(E2E_ARGS)

.PHONY: test-operations
test-operations: build-api
	python3 scripts/testOperations.py

.PHONY: test-load
test-load:
	python3 scripts/testLoad.py

GO_LINT_VERSION := $(strip $(shell cat scripts/tools/golangci-lint.version))
GO_LINT_BIN := .local/tools/golangci-lint-$(GO_LINT_VERSION)

.PHONY: lint-go format-go-check check-go-architecture check-web-architecture
$(GO_LINT_BIN): scripts/installGoLint.sh scripts/tools/golangci-lint.version
	sh scripts/installGoLint.sh
lint-go: $(GO_LINT_BIN)
	cd apps/api && ../../$(GO_LINT_BIN) run ./...
format-go-check:
	cd apps/api && unformatted=$$(gofmt -l .) && { test -z "$$unformatted" || { echo "$$unformatted"; exit 1; }; }
check-go-architecture:
	python3 -B scripts/checkGoArchitecture.py
	python3 -B scripts/testGoArchitecture.py
check-web-architecture:
	cd apps/web && npm run check:architecture
