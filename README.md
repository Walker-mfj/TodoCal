# TodoCal

A desktop web task calendar with optional Pomodoro and daily, weekly, and monthly completion analytics.

**Stack:** Next.js frontend, Go REST API, PostgreSQL. The approved visual prototype is in `docs/uiDemo`; it is separate from the production app.

## Code organization

The frontend lives in `apps/web/src`: `app` contains Next.js entry points, `home` composes the main screen at `/`, `features` owns each product feature, and `shared` holds reusable infrastructure and UI. Feature code is grouped into `components`, `hooks`, `utils`, `types`, and `constants` as needed. Components own their adjacent CSS Modules; global styles are reserved for reset, tokens, and page foundations.

The Go backend lives in `apps/api/internal`: HTTP controllers call services, services coordinate business rules and transactions, and repositories own persistence. Database migrations remain embedded in the database package. The API entry point is `apps/api/cmd/api`; it also owns the embedded notification scheduler.

Custom file and folder names use camelCase; CSS classes use kebab-case. Framework-required names and existing migration names remain unchanged. See the [folder structure guide](docs/architecture/folderStructure.md) for the current layout, module ownership, dependency boundaries, and placement rules. See the [technology stack guide](docs/architecture/techStack.md) for library usage rules and format/lint/typecheck coverage. See [local and CI quality checks](docs/architecture/qualityChecks.md) for the implemented commands, and [production architecture](docs/architecture/productionArchitecture.md) for topology and end-to-end flows.

## Current implementation

The backend provides account registration, login/logout, password changes, task CRUD and completion, group CRUD, account settings, filtering, pagination, and database migrations. Owned writes use account transactions, idempotency keys, and revision checks. Daily/every-N-days/weekly recurrence, calendar ranges, finalized daily plans, and request-driven historical planning catch-up are also implemented. The TodoCal workspace now connects to these APIs: authentication, task/group/settings forms, Day/Week/Month calendar, repeating tasks, account themes, and week/month grids of authoritative daily progress with drilldown. Calendar drag/drop, edge resizing, external task scheduling, and server-authoritative 10-second Undo are implemented. Optional account-wide Pomodoro is implemented with task-linked/free focus, pause/resume/early end, manual breaks, capped server time, and persistent cross-device state. Server-backed weekly/monthly analytics now include weighted plan completion, distinct completed tasks, focus time, Pomodoros, completed-plan days, matched prior-period comparisons, and daily drilldown. Final acceptance evidence and known limits are documented in [acceptance scenarios](docs/features/15-acceptance-scenarios.md). The visual prototype remains separate.

## Local development

Prerequisites: Go 1.26+, Node.js 24+, npm, Docker with Compose, and `make`.

```sh
cp .env.example .env
make db-up
make migrate
make api-dev
```

In a second terminal:

```sh
cd apps/web && npm ci && cd ../..
make web-dev
```

Open **http://localhost:3000** and create an account. Use `localhost`, matching `APP_ORIGIN`, rather than `127.0.0.1` in the browser. The Next.js server binds to loopback. To use a different Go port, set `API_URL=http://127.0.0.1:PORT` for Next.js dev/build; keep Go's `APP_ORIGIN` equal to the browser origin. Rewrites are fixed at build time for `npm run start`.

The API binds to `127.0.0.1:8080`; PostgreSQL binds to `127.0.0.1:55432`. `GET /healthz` checks the process, and `GET /readyz` checks database connectivity. Apply migrations explicitly before starting the API. SIGINT/SIGTERM allows up to ten seconds for in-flight requests to finish.

`APP_ORIGIN` defaults to `http://localhost:3000`, the Next.js origin. Mutations require an exact matching `Origin` and `Content-Type: application/json`. The Next.js app proxies `/api/*` to Go so browsers use one origin. Authenticated mutations also require the `X-CSRF-Token` returned by login or `GET /api/v1/auth/me`. The API does not enable cross-origin browser access.

OpenAPI: [`api/openapi.yaml`](api/openapi.yaml).

Task/group/settings writes also require an `Idempotency-Key` (16–128 characters; a fresh UUID per intended action is recommended). Keep the exact method, URI, and JSON bytes when retrying an uncertain request. A successful retry returns the original result; reusing a key for different input returns 409. Edits/deletes/completion require the `expectedRevision` returned by the last read; a stale revision returns 409. Foreign resources return 404.

`PATCH` preserves omitted editable properties. Send `null` to clear nullable task fields; clear both times when clearing a timed task's date. Task completion is a separate command, never a side effect of Pomodoro. The completion endpoint can explicitly move a future task to today. Lists accept `view`, `search`, `priority`, `status`, `groupId`, `cursor`, and `limit` (up to 100); title search is literal and case-insensitive.

`GET /api/v1/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` accepts an end-exclusive range of up to 93 days. `days` contains live/finalized daily progress and entries; `tasks` contains current tasks overlapping the window, including timed tasks that start before it. Render these identities once; use snapshot entries as historical fallbacks and for daily plan attribution. `GET /api/v1/reports/days/{date}` returns one daily plan with completed-task totals and focus-session details.

`POST /api/v1/series` accepts `task`, `cadence` (`daily`, `interval`, `weekly`), optional `intervalDays`, and nullable inclusive `endDate`. Creation generates the first occurrence; calendar reads and catch-up generate only finite ranges. `GET /api/v1/series/{id}` returns current owned metadata and revision for display and safe stopping. Each occurrence has an independent task ID and immutable `(seriesId, originalOccurrenceDate)` identity. `POST /api/v1/series/{id}/stop` cancels future incomplete occurrences while retaining today's (in the series timezone) and historical/completed records. A series retains the IANA timezone in which it was created, including when new occurrences are generated after an account timezone change. Each repeating interval may span at most 366 days to bound materialization work.

Ended days are finalized before domain reads/mutations. Catch-up uses at most 31 calendar days per transaction and a persisted watermark; the user command runs only after all necessary batches finish. A zone change first settles the old zone; forward jumps seal crossed dates at change time, and backward jumps preserve snapshots until an explicit task adjustment. Future DST gaps are skipped with an explicit calendar warning and no missed-task penalty. An overlap resolves to the earlier instant; unfinalized future gap predictions are reevaluated after series schedule edits, not account display-zone changes.

The API runs the [embedded notification scheduler](docs/architecture/notificationScheduler.md) automatically. Run `make api-dev`
after migrations; no separate worker or Cron is needed. Focus settlement,
notification delivery, recurring reminder horizons and retention cleanup have
independent bounded lanes. Domain reads/mutations retain historical planning
catch-up. Reconciliation runs every 15 minutes as a final recovery mechanism.
See [deployment instructions](deploy/README.md) for production Blue-Green deployment and single-host scheduler ownership.
The legacy Cloudflare schedule has been removed.

```sh
make lint-go           # installs the pinned linter locally on first run
make check-go-architecture format-go-check
make test-go           # unit tests; deliberately excludes database integration tests
make test-integration  # real PostgreSQL + race detector, using dedicated test databases
make build-api        # .local/focus-api
```

Integration tests reset the dedicated `focus_test` and `focus_notifications_test` databases. The runner ignores the development `DATABASE_URL`, and the Go helper refuses database names without an `_test` suffix. Do not run multiple copies of the integration suite against this shared test database simultaneously.

Frontend verification:

```sh
(cd apps/web && npm ci && npm run format:check && npm run lint)
make check-web-architecture
make generate-api-types  # checked-in OpenAPI -> TypeScript (formatted with oxfmt)
make test-web            # UI/model/API regression tests
make typecheck
make build-web
make test-e2e            # builds production web, starts isolated local API/web, runs Chrome, Firefox and WebKit
# Optional targeted browser run:
make test-e2e E2E_ARGS='--grep calendar'
```

Install test engines with `cd apps/web && npx playwright install firefox webkit` (Chrome uses the installed Google Chrome). Browser tests use these three engines, the separate `focus_web_test` database, API port 18080, and web port 3002. They create unique test accounts, do not reset development data, and stop their own servers on exit. The build uses that test API URL; rebuild with the development/production `API_URL` before running `npm run start` manually. Do not run multiple browser suites using the same ports concurrently.

Private query caches are scoped to the account and cleared on session expiry, logout, or account change. Successful authenticated API responses include `X-Account-ID`; the client refuses a response from a different account before caching it. A task editor draft is stored in sessionStorage under its owner ID, including its original revision and an uncertain command's exact payload/idempotency key. Re-authentication can restore only that account's draft; explicit logout removes that account's drafts. Group/settings drafts and uncertain commands are also stored per owner and cleared on explicit logout. Settings conflict recovery offers reapply or discard against the latest revision. Other tabs send invalidation hints, while the API remains authoritative. Visible pages refresh on focus, reconnect, successful mutations, and explicit invalidation. There is no periodic server warm-up or session polling. Disconnected writes are disabled. The form retains invalid/conflicting input and lets the user discard a conflicting draft and reload.

Timed tasks persist `scheduled_start_at` and `scheduled_end_at` as absolute instants. Create/edit inputs use account-local `scheduledDate`, optional `scheduledEndDate` (defaults to the start date), `startTime`, and `endTime`; the end must follow the start and may cross midnight or span multiple days. Changing account timezone changes only their displayed dates/clocks, preserving duration, deadline instants, and task-start reminder identities. Date-only tasks keep their calendar date. Settings provide a searchable timezone picker and a device-timezone button, applied through Save changes.

Calendar times are rendered as account-local wall-clock labels, independent of the browser timezone. When a same-day interval crosses a repeated DST hour, the calendar shows two offset-labelled pieces of the same task; open the task editor to change that interval (partial-segment dragging is disabled). Deadline inputs are converted through the account's IANA zone; nonexistent DST times are rejected. Finalized day reports retain saved plans and their original date/timezone; explicit task changes revise the affected entries and Analytics. Progress grids include all tasks regardless of calendar/list filters; future and no-plan days have no completion percentage.

Compose persists development data in the `focus_pg` volume. `docker compose stop` stops PostgreSQL without deleting data. Local credentials in Compose are development-only. See the [deployment guide](deploy/README.md) for the hosted setup.

## Authentication decisions

- Passwords: Argon2id, 64 MiB, three iterations, parallelism two, random 16-byte salt. Accepts 12–128 Unicode characters without truncation.
- Seven-day random opaque sessions; only hashes are stored. Cookies are HttpOnly and SameSite=Lax; HTTPS requires Secure cookies.
- Password changes invalidate other device sessions; logout invalidates the current session.
- Persisted email/IP authentication rate limits; untrusted forwarded headers are ignored. Before public deployment, define a trusted-proxy policy so the application can distinguish original client IPs behind the web proxy.
- Credential and database failure details are not returned or logged. Expired session/rate-limit row pruning and deployment hardening remain operational follow-ups.

## Product references

- [Feature documentation](docs/features/README.md)
- [Acceptance and verification](docs/features/15-acceptance-scenarios.md)
- [UX and accessibility](docs/features/14-ux-accessibility.md)

Calendar gestures snap changed edges to 15 minutes; form inputs retain minute precision. External drops default to 30 minutes, untimed drops clear the time, and Month moves preserve existing times. Failed saves restore the previous event; uncertain commands retain their exact retry key. Undo is owner-scoped, expires on the server, and refuses to overwrite a concurrent edit.

Focus analytics allocate saved intervals using the current account timezone, shown in day details. Historical task-plan snapshots retain their original timezone and contents. Comparisons reconstruct the cutoff day at the matching time of day; a shorter previous month is capped at its end.

## Acceptance and recovery

See [acceptance scenarios](docs/features/15-acceptance-scenarios.md) for coverage and known limits, and the [deployment guide](deploy/README.md) for configuration and migrations. Run `make test-operations` for an isolated database restart and dump/restore rehearsal; it requires Python 3 and never modifies the development database.

See [UX and accessibility](docs/features/14-ux-accessibility.md) for accessibility scope. Run `make test-load` for the isolated synthetic load harness; retain its output with the tested revision and environment.


### Task history and quick focus

Tasks can be created, edited, completed, reopened, or soft-deleted on past dates. Completing early preserves the schedule and records `completedAt`; Analytics separates scheduled-plan completion from the actual completion date. Deleted tasks offer a 10-second `Task deleted · Undo` toast, without a Recently deleted tab. Repeating tasks offer deletion of one occurrence or stopping future incomplete occurrences; stopping can also be undone from the toast.

Optional focus plans store a Pomodoro goal and per-task duration. Quick Focus appears on Calendar hover or keyboard focus; active cards show Pause or Resume. The task duration takes precedence over Settings, even without a goal. Sessions retain independent targets and actual active time, allow exceeding the plan, and never reschedule or auto-complete a task. Running and paused sessions reserve the single active slot. Each recurring occurrence has its own focus history. Migration `000009_task_history_focus` adds these fields and backfills existing completion timestamps.

### Task-time migration

Migration 22 backfills existing timed tasks using the current account timezone. For a legacy schedule made nonexistent by an earlier timezone change, it uses the latest journaled timezone for the matching schedule; without usable provenance it normalizes the start using PostgreSQL's DST-gap rule and preserves a positive wall-clock duration. Historical JSON uses its recorded timezone. Rollback refuses to discard overnight intervals: resolve those intervals before reverting the schema.
