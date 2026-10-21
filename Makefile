SHELL := /bin/sh
.DEFAULT_GOAL := help
-include .env
export
DATABASE_URL ?= postgres://focus:focus_local_only@localhost:55432/focus?sslmode=disable
APP_ORIGIN ?= http://localhost:3000
API_ADDR ?= 127.0.0.1:8080

.PHONY: help db-up migrate api-dev test-go test-integration build-api
help:
	@echo 'Commands: db-up migrate api-dev worker-dev worker-once test-go test-integration build-api build-worker'
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
