# Focus Calendar — Clear Week

A desktop web task calendar with optional Pomodoro and daily, weekly, and monthly completion analytics.

**Stack:** Next.js frontend (planned), Go REST API, PostgreSQL. The approved visual prototype is in `docs/ui-demo`; it is separate from the production app.

## Current implementation

The backend provides account registration, login/logout, password changes, task CRUD and completion, group CRUD, account settings, filtering, pagination, and database migrations. Owned writes use account transactions, idempotency keys, and revision checks. Daily/every-N-days/weekly recurrence, calendar ranges, finalized daily plans, and a background catch-up worker are also implemented. Period analytics, timer APIs, and the Next.js frontend remain pending; the prototype is not connected to this API yet.

## Local development

Prerequisites: Go 1.26+, Docker with Compose, and `make`. Node is needed when the Next.js frontend is added.

```sh
cp .env.example .env
make db-up
make migrate
make api-dev
```

The API binds to `127.0.0.1:8080`; PostgreSQL binds to `127.0.0.1:55432`. `GET /healthz` checks the process, and `GET /readyz` checks database connectivity. Apply migrations explicitly before starting the API. SIGINT/SIGTERM allows up to ten seconds for in-flight requests to finish.

`APP_ORIGIN` defaults to `http://localhost:3000`, the future Next.js origin. Mutations require an exact matching `Origin` and `Content-Type: application/json`. The Next.js app will proxy `/api/*` to Go so browsers use one origin. Authenticated mutations also require the `X-CSRF-Token` returned by login or `GET /api/v1/auth/me`. The API does not enable cross-origin browser access.

OpenAPI: [`api/openapi.yaml`](api/openapi.yaml).

Task/group/settings writes also require an `Idempotency-Key` (16–128 characters; a fresh UUID per intended action is recommended). Keep the exact method, URI, and JSON bytes when retrying an uncertain request. A successful retry returns the original result; reusing a key for different input returns 409. Edits/deletes/completion require the `expectedRevision` returned by the last read; a stale revision returns 409. Foreign resources return 404.

`PATCH` preserves omitted editable properties. Send `null` to clear nullable task fields; clear both times when clearing a timed task's date. Task completion is a separate command, never a side effect of Pomodoro. The completion endpoint can explicitly move a future task to today. Lists accept `view`, `search`, `priority`, `status`, `groupId`, `cursor`, and `limit` (up to 100); title search is literal and case-insensitive.

`GET /api/v1/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` accepts an end-exclusive range of up to 93 days. `days` contains live/finalized daily progress and entries; `tasks` contains tasks on editable dates. Use the snapshot entries for historical rendering. `GET /api/v1/reports/days/{date}` returns one daily plan; focus-session details are added later.

`POST /api/v1/series` accepts `task`, `cadence` (`daily`, `interval`, `weekly`), optional `intervalDays`, and nullable inclusive `endDate`. Creation generates the first occurrence; calendar reads and catch-up generate only finite ranges. Each occurrence has an independent task ID and immutable `(seriesId, originalOccurrenceDate)` identity. `POST /api/v1/series/{id}/stop` cancels future incomplete occurrences while retaining today's and historical/completed records.

Ended days are finalized before domain reads/mutations. Catch-up uses at most 31 calendar days per transaction and a persisted watermark; the user command runs only after all necessary batches finish. A zone change first settles the old zone; forward jumps seal crossed dates at change time, and backward jumps never reopen snapshots. Future DST gaps are skipped with an explicit calendar warning and no missed-task penalty. An overlap resolves to the earlier instant; unfinalized future gap predictions are reevaluated after zone changes.

Run the worker in another terminal:

```sh
make worker-dev       # one sweep per minute
make worker-once      # one sweep, useful for local smoke checks
make build-worker     # .local/focus-worker
```

The periodic worker retains its account cursor between bounded sweeps and limits individual account attempts to two seconds. Blocked accounts are retried after the cursor wraps, without preventing later accounts from being processed. The API uses the same lock/catch-up code and remains correct when the worker is stopped. Very large single-account batches may require query tuning; production load testing is not part of this milestone.

```sh
make test-go           # unit tests; deliberately excludes database integration tests
make test-integration  # real PostgreSQL + race detector, using focus_test only
make build-api        # .local/focus-api
```

Integration tests truncate the dedicated `focus_test` database. The runner ignores the development `DATABASE_URL`, and the Go helper refuses database names without an `_test` suffix. Do not run multiple copies of the integration suite against this shared test database simultaneously.

Compose persists development data in the `focus_pg` volume. `docker compose stop` stops PostgreSQL without deleting data. Local credentials in Compose are development-only. No public service has been deployed.

## Authentication decisions

- Passwords: Argon2id, 64 MiB, three iterations, parallelism two, random 16-byte salt. Accepts 12–128 Unicode characters without truncation.
- Seven-day random opaque sessions; only hashes are stored. Cookies are HttpOnly and SameSite=Lax; HTTPS requires Secure cookies.
- Password changes invalidate other device sessions; logout invalidates the current session.
- Persisted email/IP authentication rate limits; untrusted forwarded headers are ignored. Before public deployment, define a trusted-proxy policy so the application can distinguish original client IPs behind the web proxy.
- Credential and database failure details are not returned or logged. Expired session/rate-limit row pruning and deployment hardening remain operational follow-ups.

## Product references

- [Specification](docs/specs/2026-10-19-focus-calendar-mvp.md)
- [Implementation plan](docs/superpowers/plans/2026-10-19-focus-calendar-mvp.md)
- [Approved UI](docs/ui-demo/design-decision.md)
