# Backend authentication milestone

Date: October 20, 2026. Scope: implementation-plan Task 1 only.

## Verified

- `make test-go`: configuration validation and password hashing tests pass with the race detector. Database tests intentionally skip without their dedicated URL.
- `make test-integration`: PostgreSQL-backed tests pass with the race detector: registration, login, defaults, duplicate normalized email, invalid credentials, missing/invalid/expired/revoked sessions, CSRF and Origin rejection, persisted rate limits, password-change session revocation, atomic registration rollback, and secret redaction in account/error/log output.
- `make build-api`: runnable Go binary builds.
- `make migrate`: account migration applies; repeated migration is a no-op.
- `go vet ./...`: passes.
- Real local HTTP checks: `/healthz` returns `{"status":"ok"}` and `/readyz` returns `{"status":"ready"}`.
- Initial auth implementation was tested RED with HTTP 501; implemented handlers then passed. Runtime configuration tests were added before their implementation. Additional identity/default/rollback/redaction assertions verify the resulting boundary behavior.

Tests run against `focus_test`, separate from `focus`; the test helper rejects databases without an `_test` suffix before migrations or truncation. Test runs are serialized because they reset a shared dedicated database.

## Review status and limitations

An independent reviewer was dispatched, but its run failed immediately with a usage-limit error. Source inspection and verification here are by the author; independent review is still pending.

Task CRUD, recurrence, calendar, analytics, timer, Next.js screens, and browser acceptance tests are not implemented. The Clear Week prototype is unchanged and not backed by this API. Nothing has been publicly deployed. No claim is made that the full MVP acceptance criteria pass.

The initial API uses a small `internal/server` package with embedded SQL migrations and a separate `internal/config` package. Package extraction can follow when task-domain services are introduced. Authentication rate limits currently use the immediate peer IP; a trusted-proxy policy and expired-row retention must be addressed before public deployment.
