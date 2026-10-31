# TodoCal — Go Backend Refactoring Plan

> **Status:** Proposed implementation plan. No application behavior or schema changes are authorized by this document.
>
> **Goal:** Make Go service workflows easier to locate, test and extend while preserving the approved **layer-first** architecture.
>
> **Scope:** `apps/api/internal` and tests/CI needed to validate changes. Keep API, worker, database and public contracts stable.

## 1. Goals and non-goals

### Goals

- Split files by **cohesive workflow**, not an arbitrary line-count limit.
- Make responsibilities and dependencies between `controllers`, `services`, `repository`, `models` and `database` explicit.
- Reuse a single implementation of task mutations, events, recurrence, planning and Focus invariants.
- Keep integration tests close to the relevant workflow and introduce lightweight import-boundary checks.
- Deliver **small, reviewable PRs**, each with behavior-preserving tests.

### Non-goals

- **Do not** convert the backend to feature-first packages, Clean Architecture, hexagonal architecture, DDD aggregates or microservices.
- **Do not** introduce a generic repository, service interface for every function, event bus, dependency-injection framework, or large `shared`/`utils` dumping ground.
- **Do not** modify routes, JSON/API contract, PostgreSQL schema, migration filenames, scheduling semantics, auth, notification delivery or UI.
- **Do not** implement recurrence **This and following** in this refactor. It is a **separate business-change PR** described in the feature backlog; structural extraction must first keep the **current** behavior.
- **Do not** combine code movement with formatting of unrelated files or speculative optimization.

## 2. Current baseline and observed opportunities

The existing Go backend is already **layer-first**:

```text
apps/api/
├── cmd/
│   ├── api/main.go
│   └── worker/main.go
└── internal/
    ├── controllers/      # HTTP adapters
    ├── services/         # Commands, business workflow, transaction orchestration
    ├── repository/       # Account-scoped SQL, row mapping
    ├── models/           # Shared data shapes
    ├── dto/              # Wire parsing and command input
    ├── database/         # Transaction mechanism and SQL migrations
    ├── router/
    ├── middleware/
    ├── workers/
    ├── localdate/
    ├── monitoring/
    └── config/
```

| Existing file | Approx. lines | Current responsibilities | Refactor priority |
|---|---:|---|---|
| `services/recurrenceService.go` | 432 | `CreateSeries`, `Materialize`, `Stop`, `GetSeries`, `UpdateFromTask`, `applyFields`, `RestoreStop` | P1 |
| `services/planningService.go` | 309 | Day entries, finalization, `Settle`, `WithTx`, `DayReport`, zone transitions | P1 |
| `services/task.go` | 242 | Business errors, input validation, task lifecycle, events, recurrence exceptions | P2 |
| `services/focusService.go` | 234 | Focus elapsed time, settlement, session lifecycle, queries | P2, only where worthwhile |
| `repository/recurrenceRepository.go` | 88 | Recurrence SQL operations and mapping | **Keep intact initially** |
| `controllers/planning_test.go` | Large test suite | Several planning-related integration scenarios | P2 test clarity |

**Assessment:** Controllers such as `controllers/taskHandlers.go` are already thin. Do not rewrite them solely for architecture aesthetics. A large file that owns a single coherent workflow is acceptable; the table is a review guide, not an enforced size threshold.

## 3. Target organization

Use **multiple files in the same existing Go package**. New filenames are suggestions; preserve exported function names, routes and behavior unless a separate product change explicitly approves them.

```text
apps/api/internal/
├── controllers/
│   ├── taskHandlers.go
│   ├── focusHandlers.go
│   └── ...
├── services/
│   ├── commands.go                  # Existing Execute / View frame
│   ├── commandInput.go
│   ├── commandTypes.go
│   ├── errors.go                    # Extract business error constructors when useful
│   │
│   ├── recurrenceCreation.go       # CreateSeries, GetSeries
│   ├── recurrenceMaterialization.go# Materialize + occurrence guards
│   ├── recurrenceEditing.go        # UpdateFromTask, applyFields
│   ├── recurrenceStopping.go       # Stop, RestoreStop
│   │
│   ├── planningSnapshot.go         # Finalize, finalizeAt, snapshot entries
│   ├── planningSettlement.go       # Settle, WithTx, BeforeZoneChange
│   ├── planningReport.go           # DayReport, DayAt, presentation helpers
│   │
│   ├── taskValidation.go           # Validate, CheckGroup, editable-date rules
│   ├── taskLifecycle.go            # Get/Create/Update/Complete/Delete task
│   ├── taskEvents.go               # Event, recurrence exception coordination
│   │
│   ├── focusService.go             # Start, Change, Active, History
│   ├── focusSettlement.go          # settle, elapsed and interval helpers if cohesive
│   └── ...                         # Existing command handlers and other services
├── repository/
│   ├── recurrenceRepository.go     # Keep existing SQL ownership
│   ├── planningRepository.go
│   ├── taskRepository.go
│   ├── focusRepository.go
│   └── ...
├── models/
├── database/
└── workers/
```

**Important:** This is a **target example**, not a request to create empty placeholder files. Some helpers can stay together when splitting them increases indirection. After extraction, delete superseded definitions; do not maintain two copies of a workflow.

### Package conventions

- Keep the Go package name `services` for all service files, `repository` for repository files, etc.
- File names follow existing camelCase conventions; `*_test.go` remains the Go test suffix.
- Prefer unexported helpers unless there is a real cross-package consumer.
- Avoid changing exported signatures: preserving calls is safer than introducing a new public service interface.

## 4. Dependency and ownership rules

```text
router / middleware
         |
         v
    controllers -----> dto
         |
         v
      services -----> models / localdate
         |
         v
     repository -----> database mechanisms / models
         |
         v
      PostgreSQL

workers ------> services (not controllers)
```

| Package | Can depend on | Must not depend on / own |
|---|---|---|
| `controllers` | `services`, `dto`, `models`, HTTP infrastructure | Task/recurrence invariants or inline SQL |
| `services` | `repository`, `models`, `localdate`, `database` transaction boundary | HTTP handlers, router, response rendering |
| `repository` | `models`, `database` interfaces/driver | `services`, controllers, HTTP status |
| `models` | Standard library and genuinely pure domain types | Controllers, repository, database connections |
| `workers` | Services and bounded worker-specific infrastructure | Controller as a business API or independent mutation rules |
| `database` | PostgreSQL driver, migrations and transaction primitives | Feature-specific product policy |

Because **all service files currently share one package**, Go's compiler does not enforce business ownership between individual services. Use clear function responsibility and tests; do not introduce many new packages solely to fake that boundary.

### Transaction boundary — do not change

Authenticated writes already use `services.Execute` and `services.WithTx` for account serialization, settlement, session validation, revision conflict checking and mutation receipts.

- `database.WithTx` uses `SELECT ... FOR UPDATE` on the owned settings row; this is **not** a PostgreSQL advisory lock.
- `services.WithTx` may commit several bounded historical catch-up transactions **before** opening the final user-command transaction.
- The business operation and its idempotency receipt must commit atomically in the **final** transaction. A failed business operation cannot leave a successful receipt.
- Repositories must **not** independently commit portions of a multi-step mutation.
- Background worker logic should call the same service rules instead of inventing a parallel write path.
- Keep every `user_id` ownership predicate, revision check, rollback behavior and original-slot guard.

## 5. Execution phases and PR boundaries

### PR A — Baseline, safety tests, and inventory (P0)

**Purpose:** Lock in existing behavior before moving implementation.

- Inventory public service functions, their callers and tests; identify package-private helpers and side effects.
- Add focused characterization tests for recurrence materialization/edit/stop/restore; planning finalization/catch-up; task events and historical adjustments; Focus settlement.
- Include seeded deterministic account-local dates, DST gap/overlap and revision-conflict cases where relevant.
- Record passing commands and known failures before any file movement; never mark skipped tests as passed.

**Done when:** Existing behavior is captured and baseline tests pass in isolation. No source reorganization required yet.

### PR B — Recurrence service split (P1)

**Files:** `services/recurrenceService.go` → suggested `recurrenceCreation.go`, `recurrenceMaterialization.go`, `recurrenceEditing.go`, `recurrenceStopping.go`.

**Move responsibilities without changing semantics:**

- `CreateSeries` and `GetSeries`: series input validation and template creation/read.
- `Materialize`: bounded slot creation, original-slot identity, deleted/moved/invalid-time exceptions, guard against regeneration.
- `UpdateFromTask` and `applyFields`: the **currently implemented** series edit behavior, including its existing scope and revision checks.
- `Stop` and `RestoreStop`: cutoff logic, candidate selection, reversible soft deletion and conflict handling.

Keep SQL in `repository/recurrenceRepository.go`; avoid moving SQL into `services`. Do **not** implement a new tail-split algorithm in this PR.

**Acceptance:** No changed endpoints or payloads, no duplicate slots on repeated reads, unchanged history/Focus links, unchanged current edit/stop scopes, atomic conflict behavior, tests pass.

### PR C — Planning and transaction clarity (P1)

**Files:** `services/planningService.go` → `planningSnapshot.go`, `planningSettlement.go`, `planningReport.go`.

- Snapshot extraction: `Finalize`, `finalizeAt`, live/historical entry enrichment and persistence.
- Settlement extraction: `Settle`, `WithTx` and zone-change coordination; keep bounded catch-up semantics identical.
- Report extraction: `DayReport`, `DayAt` and report-only helpers. Preserve existing `percentage` / presentation semantics.
- Avoid cycles and **do not** replace the current account lock or split an atomic task event/snapshot update across transactions.

**Acceptance:** Historical snapshots, weighted progress, timezone boundaries and group presentation remain unchanged; catch-up still respects batch limits; concurrent commands retain serial behavior.

### PR D — Task lifecycle, validation and event clarity (P2)

**Files:** `services/task.go` and relevant `services/history.go` / `taskCommands.go`; proposed `taskValidation.go`, `taskLifecycle.go`, `taskEvents.go`, optionally `errors.go`.

- Consolidate business validation, while retaining the existing exact server-side acceptance/rejection rules.
- Isolate task mutations from their event-journal and historical-adjustment support without making them separate commits.
- Preserve before/after event snapshots, `completed_at`, soft delete/restore, recurrence exception behavior and optimistic revision checks.
- Use shared existing helpers when multiple workflows truly have identical rules; do not change semantics to make code look DRY.

**Acceptance:** Same API responses and task revisions, no double-counted completion, no changed old-day snapshots unless requested by a legitimate command, and full rollback on injected failure.

### PR E — Focus cohesion and selective shared helpers (P2)

**Files:** `services/focusService.go` and Focus command tests.

- Consider extracting `settle`, `elapsedFocus`, `closeInterval` and `focusMaxTime` into `focusSettlement.go` if it clarifies the session lifecycle.
- Keep `Start`, `Change`, `Active` and `History` grouped with a clear API; do not split if extra files obscure the logic.
- Retain the authoritative timestamps, session intervals, one-active-session invariant, Pomodoro-counting rules and ownership.
- Do **not** add background notification scheduling or change currently request-triggered settlement in this refactor.

**Acceptance:** Paused/running/completed/ended Focus state and analytics remain identical; retry and time-travel tests protect settlement.

### PR F — Test organization and architecture checks (P2)

- Split oversized `controllers/planning_test.go` into **scenario-cohesive** `*_test.go` files only where it improves navigation. Keep common fixtures minimal and setup deterministic.
- Keep Go unit tests beside packages and real database integration tests through the existing test runner and isolated `*_test` databases.
- Add a lightweight CI script or static inspection using `go list` (or equivalent) to guard forbidden edges: `repository → services`, `services → controllers/router`, `models → repository/controllers`, `shared infrastructure → HTTP controllers`.
- Treat `go vet` as useful complementary validation, **not** as a custom architecture-boundary checker.
- Avoid flagging legitimate SQL in `repository` or the migration package. Document any permitted import exceptions explicitly.

**Acceptance:** CI catches a deliberate forbidden import in a controlled test, package graph remains acyclic, and no new architectural toolchain is required unless the simple guard proves inadequate.

## 6. Cross-cutting regression matrix

| Invariant | Minimum regression scenario |
|---|---|
| Authentication / ownership | Account B cannot read or mutate account A's task, series, settings or Focus session |
| Revisions | Two writers using the same old revision: one succeeds, the other returns 409 |
| Idempotency | Retry identical request/key returns the same response without repeating domain writes |
| Receipt atomicity | Failed mutation leaves no committed successful receipt |
| Task journal | Create/edit/complete/reopen/delete/restore produces the expected before/after events |
| Finalized history | Unrelated mutations do not rewrite past snapshots; explicit historical edits adjust them correctly |
| Recurrence identity | Repeated materialization, move, delete, DST handling and restore do not create duplicates |
| Recurrence scope | **Current** “all” and Stop behavior remains unchanged during structural refactoring |
| Undo | Schedule undo expiry/revision conflict and series-stop recovery remain unchanged |
| Focus | One active session, accurate interval time, no double Pomodoro, task completion remains explicit |
| Timezone | Local midnight/DST boundaries, forward/backward timezone changes retain intended history |
| Worker | Bounded sweeps use service rules and do not make unrelated accounts unavailable |

For database-oriented tests, use `make test-integration`; do not run destructive fixtures against development or production databases.

## 7. Verification commands

Run after each relevant PR:

```bash
make test-go
make test-integration
make build-api
make build-worker
cd apps/api && go vet ./...
```

For changes with endpoint/contract risk, also run:

```bash
make generate-api-types
make test-web
make typecheck
make test-e2e
```

The Go build/test baseline alone does **not** verify that all HTTP behavior remained identical; compare request/response fixtures and run integration tests for the affected workflow. A blocked test or unavailable database must be reported, not silently counted as success.

## 8. Definition of done (per PR)

- [ ] No observable behavior change unless this PR explicitly has separate product approval.
- [ ] Existing Go packages remain **layer-first**, with no forbidden import edge or cycle.
- [ ] Functions remain in the correct owner package; obsolete/duplicate helpers are removed.
- [ ] No new SQL in controllers or feature-specific business rules in repositories.
- [ ] Every account-owned query keeps ownership checks.
- [ ] All account locks, settlement batches, revision checks and receipts preserve transaction invariants.
- [ ] Characterization tests and relevant integration/E2E tests pass, with actual command output cited in the PR.
- [ ] No changed API paths, request/response shapes, schema or migration history.
- [ ] Related documentation is updated when file ownership or behavior changes.
- [ ] PR diff excludes unrelated formatting, generated files and speculative abstractions.

## 9. Deferred functional changes

Keep the following in **separate** product implementation PRs, even if they touch the same service files:

- **Recurrence This occurrence / This and following:** split/rekey series and new delete cutoff semantics. The current refactor **must not** implement those semantics under the label “cleanup”.
- Background worker settlement of elapsed Focus sessions and Web Push.
- New retention or Trash recovery policy, and original-versus-adjusted historical baseline.
- Settings validation contract changes, unless independently agreed and tested.

The implementation backlog in [feature documentation](../features/16-implementation-backlog.md) tracks these functional changes. If that file is not yet merged into the target branch, do not infer that the functionality has shipped.

## 10. Related documentation

- [Folder structure guide](folderStructure.md) — authoritative package and naming conventions.
- [Feature specifications](../features/README.md) — user-facing current behavior.
- [API contract](../../api/openapi.yaml) — API request/response shapes.
- [Developer commands](../../README.md) — build and test entry points.
- [Deployment instructions](../../deploy/README.md) — worker versus deployed API constraints.

**Maintenance:** Track implementation status in the individual code PRs; update this plan only when ordering, ownership rules or acceptance criteria change.
