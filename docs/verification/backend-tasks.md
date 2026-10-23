# Owned task API milestone

Date: October 20, 2026. Scope: implementation-plan Task 2.

## Implemented

- Owned task create/read/partial-update/soft-delete, completion/reopening, literal title search, filters, and cursor pagination.
- Title-only tasks with optional schedules, deadlines, groups, priorities, and Pomodoro estimates. Minute precision is retained; invalid ranges and nonexistent DST wall times are rejected.
- Future completion requires an explicit move to today. Unscheduled completion does not schedule a task. Same-day reopening invalidates completion events.
- Owned group CRUD; deleting a group detaches its tasks and increments their revisions without deleting them.
- Account settings read/partial-update, including Light/Dark and time zone.
- One transaction and account-row lock per command; effects, before/after events, and idempotency receipts commit together. Composite foreign keys enforce task/group and event/task ownership.
- Stable response replay for identical requests, 409 for mismatched idempotency keys or stale revisions, 404 for foreign resources, and 422 for invalid input.

## Verification

- Initial task integration tests failed with missing-route 404 responses before implementation.
- A null setting regression failed (`sound: null` returned 200 and changed the preference); shared payload validation then made it return 422.
- `make test-go` and `make test-integration` pass with race detection. Six task integration scenarios cover CRUD, optional Pomodoro, ownership, malformed inputs, rollback on event failure, concurrent duplicate creation, concurrent edits, future completion, reopening events, filtering/pagination, and settings isolation. Existing auth tests also pass.
- `make build-api`, `make migrate`, and `go vet ./...` pass.
- OpenAPI YAML parses and all internal references resolve. The contract describes the implemented endpoints and retry/revision semantics.

## Review and remaining work

A fresh reviewer inspected the implementation and found no critical or important findings. The reviewer's attempted unit test was blocked by build-cache permissions; the author's successful verification above is the execution evidence.

Resolved October 23: accepted UUID aliases (URN, compact, braces and uppercase) are normalized before SQL. `uuid_test.go` exercises aliases across reads/mutations, malformed values and ownership. The former URN HTTP 500 regression is covered.

The reviewer deferred later recurrence/history, undo, and frontend work, and the OpenAPI/docs being edited concurrently. These remain outside this milestone; the author checked the contract separately.

Task 3 must add chronological history catch-up inside the existing account transaction, before mutations and timezone changes. Daily snapshots, recurrence, calendar/report/timer APIs, and Next.js UI remain pending. Task events alone are not finalized daily reports. The visual prototype is unchanged and remains disconnected from PostgreSQL.
