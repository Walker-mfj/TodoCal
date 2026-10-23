# Focus Calendar MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Clear Week as a desktop task calendar with account-owned data, recurring tasks, completion analytics, and optional Pomodoro.

**Architecture:** Next.js App Router renders the frontend and calls a separate Go REST API. Go owns authentication, authorization, domain rules, transactions, recurrence, historical snapshots, timers, and reports; PostgreSQL is the source of truth. A Go worker catches up ended days; API reads/mutations also catch up as needed, so worker availability is not required for correctness.

**Tech Stack:** Next.js, TypeScript, React, FullCalendar React, CSS tokens, TanStack Query for API caching, Go `net/http`, pgx/PostgreSQL, versioned SQL migrations using golang-migrate, Argon2id, OpenAPI, Go testing/httptest, Vitest/Testing Library, Playwright, and Docker Compose for local PostgreSQL. Resolve compatible supported versions at implementation time; pin npm dependencies, Go modules, and container versions. No Dexie or fake-indexeddb: PostgreSQL integration tests replace browser-database tests.

**Spec:** [MVP specification v2.0](../../specs/2026-10-19-focus-calendar-mvp.md).

**UI Decision:** [Clear Week](../../ui-demo/design-decision.md), selected October 20, 2026; preserve its refinements and both Light/Dark modes.

## Global Constraints

- Desktop web, minimum target width 1024 px; no mobile-specific UI.
- All code, documentation, and UI copy are English; user conversation remains Vietnamese.
- Pomodoro is optional. Task completion never requires a timer or focus minutes.
- Week starts Monday; month uses the Gregorian calendar. Account time zone defines day boundaries.
- Historical plans remain immutable after finalization, including after task deletion/rescheduling.
- Calendar drag snapping is 15 minutes; forms permit minute precision; Undo lasts 10 seconds.
- Recurrence: daily, every N days (2–365), or weekly, with an optional inclusive end date.
- PostgreSQL stores account data; Go is the only application service accessing it. Do not implement a competing Next.js domain backend.
- Login and cross-device access are in scope. Offline mutation queues, collaboration, email verification/password recovery, OAuth, and production deployment are outside this implementation scope.
- Demo sample data, fixed dates, preview recurrence caps, and mock timer are not production requirements.
- Preserve unrelated user files and the demo. Do not publish or provision external services during implementation.

## Review Focus

1. Cross-account IDs in nested payloads must never bypass ownership checks (Tasks 1–2).
2. Retried requests or concurrent edits must not duplicate actions or overwrite newer changes (Tasks 2, 5).
3. DST boundaries, timezone changes, and closed-browser recurrence catch-up must preserve history (Task 3).
4. Two devices starting/ending a timer must produce one session and one completion (Task 6).
5. Authentication expiry/network failure must preserve drafts without claiming unsaved changes succeeded (Tasks 4, 8).

## Repository Layout

- `apps/web/`: Next.js app, npm manifest/lockfile, UI tests.
- `apps/web/src/app/`: root layout/providers, protected workspace, login/register pages.
- `apps/web/src/features/{tasks,calendar,analytics,focus,settings}/`: feature UI and API hooks.
- `apps/web/src/lib/{api.ts,query.ts,api-types.ts}`: fetch client, cache policy, generated contract types.
- `apps/api/cmd/{api,worker}/main.go`: API and worker entrypoints.
- `apps/api/internal/{auth,account,tasks,recurrence,planning,focus,analytics}/`: domain services and handlers.
- `apps/api/internal/{db,httpapi,clock}/`: database access, middleware/errors, testable clock.
- `apps/api/migrations/`: ordered SQL migrations.
- `api/openapi.yaml`: versioned request/response contract.
- `tests/e2e/`: browser journeys against real Next.js + Go + test PostgreSQL.
- `compose.yaml`, `Makefile`, `.env.example`: repeatable local infrastructure and commands.
- `docs/verification/mvp-acceptance.md`: evidence for spec criteria 1–50.

## Data and API Contracts

Use UUIDs, local ISO dates and `HH:mm` times, RFC 3339 UTC API timestamps, PostgreSQL `date`/`time`/`timestamptz`, and integer focus seconds. Server time is authoritative. Use `time.LoadLocation` with bundled tzdata in Go; test DST gaps (reject invalid scheduled times) and overlaps (choose the earlier occurrence).

Every owned table includes `user_id`: tasks, groups, task_events, recurrence_series, recurrence_exceptions, daily_plan_entries, daily_snapshots, focus_sessions, focus_intervals, settings, undo_actions, and mutation_receipts. Users and auth_sessions support authentication. Use composite ownership foreign keys, not only client-provided IDs. Tasks have `revision`, soft-deletion timestamp, nullable series ID/original occurrence date, and optional Pomodoro estimate. Constraints include:

- unique normalized email;
- unique `(user_id, series_id, original_occurrence_date)` for recurring occurrence identity;
- unique `(user_id, date)` snapshots and `(user_id, date, task_id)` historical plan entries;
- a partial unique index on `focus_sessions(user_id)` for running/paused status;
- unique `(user_id, idempotency_key)` mutation receipt with request hash and stored response.

Shared Go interfaces: `Clock.Now() time.Time`; `WithAccountTx(ctx context.Context, userID uuid.UUID, fn func(pgx.Tx) error) error`; services receive the authenticated user ID from middleware, never from request bodies. Serialize account mutations by locking the user's settings row, settle elapsed sessions/materialize due recurrence/finalize ended days, then execute the command and commit. Internal catch-up helpers accept the existing transaction and must not recursively call the transaction runner.

Create `api/openapi.yaml` before UI integration. Define editable TaskInput, Task (including revision), RecurrenceRule, Settings, FocusSession, DayProgress, DayReport, PeriodReport, UndoToken, and APIError schemas. The schema is the source for frontend TypeScript types.

| Endpoint | Contract |
| --- | --- |
| POST `/api/v1/auth/register`, `/login` | Email/password; set opaque session cookie; return current user and CSRF token |
| GET `/api/v1/auth/me` | Current user, settings, and CSRF token |
| POST `/api/v1/auth/logout`, `/password` | Revoke current session or change password and revoke other sessions |
| GET/POST `/api/v1/tasks`; GET/PATCH/DELETE `/tasks/{id}` | Paginated task list (cursor, limit ≤100, filters/search), create, inspect, revise, soft-delete |
| POST `/api/v1/tasks/{id}/completion` | `{complete, expectedRevision, moveToToday?}`; atomic completion command |
| POST `/api/v1/tasks/{id}/schedule` | Schedule and expected revision; return task and server-stored UndoToken |
| POST `/api/v1/undo/{id}` | Restore previous schedule only if unexpired, revision matches, and historical date remains editable |
| GET/POST `/api/v1/groups`; PATCH/DELETE `/groups/{id}` | Owned group CRUD; deletion clears membership |
| POST `/api/v1/series`; POST `/series/{id}/stop` | Create recurrence; stop future occurrences while retaining history |
| GET `/api/v1/calendar?from=&to=` | End-exclusive range ≤93 days; live tasks, historical entries, per-day progress |
| GET `/api/v1/reports?period=day|week|month&date=` | Aggregate + daily metrics + previous comparable period |
| GET `/api/v1/reports/days/{date}` | Daily plan states and focus sessions |
| GET `/api/v1/focus/active`; POST `/focus` | Read active timer; start optional task-linked or free session |
| POST `/api/v1/focus/{id}/pause`, `/resume`, `/end` | Serialized, revision-checked session actions |
| GET/PATCH `/api/v1/settings` | Account time zone, durations, sound, appearance; expected revision |

All mutation endpoints except registration/login require CSRF validation. Owned mutations require `Idempotency-Key`; successful receipt and effect commit together. Reusing a key with different payload returns 409. Registration is protected by unique email; login/register are origin-checked and rate-limited. Return 401 for missing/expired session, 404 for missing/foreign resources, 409 for stale revision or active-session conflict, 422 for field validation. Error envelope: `{error:{code,message,fields?,requestId}}`.

Use same-origin `/api/*` routing to Go (Next.js development rewrite; deployment reverse proxy later). Cookies are HttpOnly, Secure under production HTTPS, SameSite=Lax, scoped to `/`; check Origin and a session CSRF token for mutations. Session tokens are 32 random bytes, stored hashed, expire after seven days, and rotate on login. Passwords use salted Argon2id (64 MiB, three iterations, parallelism two, 16-byte salt, 32-byte output), stored in an encoded format and verified with constant-time comparison. Accept 12–128 characters without silently truncating. Rate-limit authentication by account/IP with persisted short-window counters; generic failed-login messages. Never log credentials, tokens, or task descriptions.

## Task 0: Approved UI Reference

- [x] User selected Clear Week.
- [x] Demo includes Light/Dark, week/month reports, daily detail rings/colors, and recurrence creation.
- [x] Record design choice in `docs/ui-demo/design-decision.md`.
- [ ] Extend the same visual language to login/register and connection/conflict states during UI implementation.

## Task 1: Runnable Go/PostgreSQL Authentication Slice

**Files:** Create Compose/Makefile/env example, `apps/api/go.mod`, API entrypoint, `internal/db`, `internal/auth/{service.go,handlers.go,service_test.go}`, `internal/httpapi`, `migrations/000001_accounts.{up,down}.sql`, `api/openapi.yaml`.

**Interfaces:** `Register(ctx, email, password) (User, error)`, `Login(ctx, email, password) (Session, error)`, `Authenticate(ctx, token) (Principal, error)`, `Logout(ctx, sessionID) error`, and `ChangePassword(ctx, principal, oldPassword, newPassword) error` on `auth.Service`; Principal carries user/session ID. Never expose password hashes.

- [x] Establish `make db-up`, `make migrate`, `make api-dev`, `make test-go`, and `make test-integration`; pin dependency versions and isolate the integration database from development data.
- [x] Write failing httptest/PostgreSQL tests: registration/login, duplicate email, wrong password, missing/expired/revoked session, CSRF rejection, generic errors/rate limiting, password change revoking other sessions. Run `make test-go` and `make test-integration`; verify missing behavior fails.
- [x] Implement migrations, session middleware, handlers, health/readiness endpoints, graceful shutdown, cookie policy, and account defaults. Add OpenAPI definitions for auth/error responses.
- [x] Re-run both commands; verify secrets are absent from responses/log fixtures. Commit `feat: add Go API PostgreSQL and account sessions`.

**Implementation note (October 20, 2026):** The initial auth handlers and shared HTTP helpers live in `apps/api/internal/server`; SQL migrations are embedded beneath that package so the built binary does not depend on the current working directory. Runtime configuration lives in `internal/config`. The domain-service split remains available as task APIs are added. Evidence is in `docs/verification/backend-auth.md`. Independent review was attempted but could not run because of the reviewer usage limit; this milestone has author verification only.

## Task 2: Account-Owned Tasks and Atomic Mutations

**Files:** `internal/tasks/{service.go,handlers.go,service_test.go}`, `internal/account`, `internal/db/transactions.go`, `migrations/000002_tasks.{up,down}.sql`; extend OpenAPI.

**Interfaces:** `Create(ctx, userID, input TaskInput) (Task,error)`, `Update(ctx,userID,id,input,revision) (Task,error)`, `Complete(ctx,userID,id,complete,moveToToday,revision) (Task,error)`, `Delete(ctx,userID,id,revision) error`; a command wrapper manages idempotency and transaction ownership.

- [x] Write failing tests: title-only/no-Pomodoro task; whitespace-title and invalid times; unscheduled completion; group deletion; rollback after injected event-write failure; foreign task/group IDs; repeated same-key creation; mismatched-key payload; stale revisions. Run task tests against PostgreSQL and inspect expected failures.
- [x] Implement owned SQL queries, event history, task/group/settings endpoints, soft deletion, mutation receipts, and revision conflicts. Use explicit same-account relation checks and constraints.
- [x] Run `make test-go` and `make test-integration`; require no cross-account disclosure and atomic rollback. Commit `feat: add account-owned task APIs`.

**Implementation note (October 20, 2026):** Task domain functions receive the existing transaction in `internal/tasks`; `internal/account.WithTx` owns account locking and commit. HTTP handlers and mutation receipts live in `internal/server`, with migrations embedded there. Historical catch-up is explicitly reserved for Task 3. Verification and the deferred review finding are recorded in `docs/verification/backend-tasks.md`.

## Task 3: Recurrence and Daily History

**Files:** `internal/recurrence/{service.go,service_test.go}`, `internal/planning/{service.go,service_test.go}`, worker entrypoint, `migrations/000003_planning.{up,down}.sql`.

**Interfaces:** Transaction-level `Materialize(ctx,tx,userID,from,to) error`, `FinalizeEndedDays(ctx,tx,userID,now) error`, `ProjectDay(ctx,tx,userID,date,cutoff) (DayReport,error)`. API services expose series creation/stop and calendar reads.

- [x] Write failing tests: daily Oct 19–25 gives seven occurrences; every two days gives 19/21/23/25; weekly through Nov 2 gives 19/26/2; inclusive end; invalid interval; independent completion; deletion/move exception prevents regeneration; finite open-ended generation; stop-series history; inherited deadline offsets.
- [x] Add history tests: 3/5=60%, add task→50%, empty day→null; carryover preserves Monday's snapshot; delayed catch-up materializes due occurrences before finalization; DST gap/overlap; changing zone backward leaves snapshots immutable; concurrent worker/API creates one occurrence/snapshot. Run targeted Go/integration tests and verify failures.
- [x] Implement server calendar arithmetic and idempotent range materialization. Catch up chronologically in bounded transaction batches, persist a per-account watermark, and block a conflicting mutation until required history is settled. Use the shared account lock for worker and API.
- [x] Add a minute-based worker sweep and API fallback; do not require an external scheduler. Skip accounts/dates with no relevant plan data; never pre-generate infinite series.
- [x] Run `make test-go` and `make test-integration`; commit `feat: preserve recurring plans and daily history`.

**Implementation note (October 21, 2026):** `internal/planning.WithTx` settles ended days in bounded account transactions before the caller runs. `internal/recurrence` materializes finite ranges and retains occurrence exceptions; `internal/localdate` handles DST gaps/overlaps. Calendar and day-detail endpoints expose live/finalized plans. The worker retains sweep progress between runs and bounds individual account attempts. DST skips, forward-zone transition semantics, and verification evidence are recorded in `docs/verification/backend-history.md`.

## Task 4: Next.js Clear Week Frontend and API Integration

**Files:** `apps/web/package.json`, lockfile, Next/TypeScript/Vitest configs, `src/app/{layout.tsx,page.tsx,providers.tsx,globals.css}`, auth routes, `src/lib/{api.ts,api-types.ts,query.ts}`, task/calendar/settings features, UI tests.

**Interfaces:** `apiFetch<T>(path, options): Promise<T>` includes session cookies, CSRF, stable retry keys, and typed errors. Query keys include authenticated user ID. Calendar consumes the calendar API; it never reads PostgreSQL directly.

- [ ] Establish `make web-dev`, `make typecheck`, `make test-web`, `make build-web`; use Next dev/build/start. Generate API types from the checked-in OpenAPI contract. Do not access window/storage during server rendering.
- [ ] Write failing UI tests: sign-in/register/logout flow; title-only tasks; recurrence form summary and inclusive date validation; error input preservation; logout/account switch clears cached data; Light/Dark persists to account; expired session preserves a draft only for its original account. Run `make test-web`.
- [ ] Implement auth screens and Clear Week shell, task/group CRUD, filters/search, detail editor, recurrence creation/stop, and settings. Each occurrence edit is explicitly scoped to itself.
- [ ] Implement Day/Week/Month calendar, default current week, Monday-first, untimed/unscheduled areas, overflow, historical details, progress unaffected by filters, and accessible keyboard alternatives. Click 09:00 defaults to 09:00–09:30; selection preserves 09:00–10:30.
- [ ] Refresh after acknowledged mutation, focus/reconnect, and every 15 visible seconds. Show connection state, disable disconnected writes, preserve drafts, and handle 401/409/422 distinctly. Use BroadcastChannel as an invalidation hint only; the API remains authoritative.
- [ ] Run `make test-web`, `make typecheck`, `make build-web`; verify task persistence in a second authenticated browser context. Commit `feat: add Next.js Clear Week workspace`.

## Task 5: Calendar Scheduling and Undo

**Files:** `internal/tasks/schedule.go`, `schedule_test.go`, undo migration, `apps/web/src/features/calendar/{interactions.ts,UndoToast.tsx}`, `tests/e2e/calendar.spec.ts`.

**Interfaces:** `Reschedule(ctx,userID,id,schedule,revision) (Task,UndoToken,error)`; `Undo(ctx,userID,tokenID) (Task,error)`. Store the previous schedule server-side with expiration and resulting revision; never trust a client-supplied historical state.

- [ ] Write failing tests for 15-minute drag snap, minute-precision form, edge resize, external drop, clearing time, Month date move preserving duration, midnight rejection, unchanged deadline, 10-second undo expiry, foreign undo ID, concurrent edit conflict, historical-day rejection, and server rollback restoring the visual event.
- [ ] Run targeted Go/web tests; implement transaction-safe schedule/undo APIs and FullCalendar handlers. Retry timed-out moves with the same key and show conflicts without losing input.
- [ ] Run integration tests and `make test-e2e` with calendar filter; commit `feat: add safe calendar scheduling and undo`.

## Task 6: Account-Wide Optional Pomodoro

**Files:** `internal/focus/{service.go,elapsed.go,service_test.go}`, focus migrations, `apps/web/src/features/focus/{TimerPanel.tsx,TimerBar.tsx,useFocus.ts}`, `tests/e2e/focus.spec.ts`.

**Interfaces:** `Start(ctx,userID,taskID,kind) (FocusSession,error)`; `Pause/Resume/End(ctx,userID,id,revision) (FocusSession,error)`; `Active(ctx,userID) (*FocusSession,error)`. Start accepts nullable task ID and stores duration settings at start.

- [ ] Write failing tests: 25/5/15 defaults, long break after four full sessions, 10-minute early end=600 seconds/zero Pomodoros, no paused/break time, no task completion side effects, target cap, closed-browser catch-up, no automatic next session, and settings changes not affecting active sessions.
- [ ] Add real PostgreSQL concurrency tests with two authenticated device sessions: only one running/paused focus slot; double end records once; stale pause/resume rejected; clock-skewed clients cannot inflate seconds. Run targeted tests and verify failures.
- [ ] Implement persisted server intervals and capped elapsed computation. Settle expired running sessions before claiming a new active slot. UI extrapolates from server time and refreshes state on focus/reconnect; disconnected controls cannot claim a server state change.
- [ ] Add optional task/free focus actions, compact timer bar, manual next-session controls, permission-aware sound/notifications. Notification denial must not block normal use.
- [ ] Run Go/integration tests and focus E2E; commit `feat: add account-wide optional Pomodoro`.

## Task 7: Server Analytics and Motivating Daily Progress

**Files:** `internal/analytics/{service.go,ranges.go,service_test.go}`, report handlers, `apps/web/src/features/analytics/{AnalyticsPage.tsx,DayDetails.tsx,ProgressRing.tsx,CompletionLegend.tsx}`, `tests/e2e/analytics.spec.ts`.

**Interfaces:** `Period(ctx,userID,period,date) (PeriodReport,error)`; `Day(ctx,userID,date) (DayReport,error)`. Include authoritative counts, nullable ratio, distinct completed IDs, focus seconds/Pomodoros, daily breakdowns, and labeled comparison range.

- [ ] Write failing tests: 1/1+0/9=10%; moved task counts twice in plans but once among completed IDs; recurring occurrences count independently; same-day reopen invalidates event; later reopen preserves history; unscheduled completion affects only completed-task count.
- [ ] Test no-plan/future exclusion, active focus/midnight splits with pauses, shorter preceding month, partial current week, and 9999/10000 never displaying 100%. Assert exact color thresholds using unrounded ratios and period/day reconciliation; prevent access to other accounts' reports.
- [ ] Run targeted Go and UI tests; implement server aggregation and week/month/day comparisons. Populate reports from the same snapshot/live data, not independent browser calculations.
- [ ] Implement Weekly/Monthly navigation, previous/next/current controls, selectable daily details, progress rings, gray/amber/blue/teal/green legend, and completed-day checkmarks. No-plan/future states stay dashed/neutral; encouragement is factual and never pressures historical days. Retain both Light/Dark and separate focus charts.
- [ ] Run integration/UI/E2E checks; commit `feat: add server-backed completion analytics`.

## Task 8: End-to-End Acceptance and Operational Checks

**Files:** `tests/e2e/acceptance.spec.ts`, `docs/verification/mvp-acceptance.md`, `README.md`; modify only files required by verified defects.

- [ ] Add journeys for two separate accounts and two devices on one account; cookie expiry, reconnect, stale edits, retry, database restart, worker downtime, keyboard-only workflows, long task names, empty states, and denied notifications.
- [ ] Verify a database migration from a prior schema and rollback on a disposable database; exercise PostgreSQL dump/restore locally and document recovery instructions. Do not use the user's production data.
- [ ] Run `make test-go` (`go test -race ./...`), `make test-integration` against real PostgreSQL, `make test-web`, `make typecheck`, `make build-web`, and `make test-e2e`. Never replace database concurrency tests with in-memory mocks.
- [ ] Inspect Clear Week at 1024/1440 px in Light/Dark, including auth/forms/conflicts and progress colors. Record evidence for spec criteria 1–50 and exact known limits.
- [ ] Document environment variables, local startup, migrations, cookies/CSRF, account isolation, online-only mutations, refresh interval, notification limits, and out-of-scope email recovery. No credentials in committed examples.
- [ ] Conduct final code review, fix actionable findings, and re-run affected checks. Commit `test: verify full-stack MVP acceptance`.

## Coverage

| Requirements | Tasks |
| --- | --- |
| Accounts, server storage, ownership, criteria 43–47 | 1, 2, 4, 8 |
| Tasks, groups, persistence, criteria 2, 10, 18–19, 22 | 2, 4 |
| Recurrence, snapshots, progress, criteria 9, 11–16, 20, 37–42, 49 | 3, 7 |
| Calendar creation/views/filters, criteria 1, 3–4, 7, 13–14, 17 | 4 |
| Drag/resize/undo, criteria 5–6, 8, 15 | 5 |
| Focus, criteria 23–29, 48 | 6 |
| Analytics/drill-down/colors, criteria 16, 21, 30–32, 35–36 | 7 |
| Appearance, connection behavior, criteria 33–34, 50 | 4, 6, 8 |
| Complete acceptance, migration/recovery, visual verification | 8 |

## Primary References

- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components).
- [Go transaction semantics](https://go.dev/doc/database/execute-transactions).
- [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).
- [Go Argon2 package](https://pkg.go.dev/golang.org/x/crypto/argon2).
- [FullCalendar interaction documentation](https://fullcalendar.io/docs/event-dragging-resizing).

## Execution Handoff

This revision supersedes the browser-only plan. The user has selected Next.js + Go + PostgreSQL and Clear Week; production code is not scaffolded. Execute the tasks in order after review of this revised plan and selection of native or subagent-driven execution. Native execution is recommended because authentication, history, recurrence, and timer concurrency share transaction boundaries. Use the required execution and worktree skills when implementation begins.

## Execution status — October 23, 2026

Tasks 1–8 were implemented and verified; the unchecked task lists above are the original execution instructions, not a live status ledger. Current evidence is in `docs/verification/mvp-acceptance.md` and `docs/verification/hardening-results.md`. The follow-up storage/UUID fixes, load checks and expanded browser acceptance are committed as `9355409`. The user now requires Chrome acceptance only (22/22 journeys passed); Safari is not a remaining gate. Manual screen-reader verification remains outstanding under the subsequent full-accessibility request. Public deployment is separate and has not been requested.
