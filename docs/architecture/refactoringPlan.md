# TodoCal — Integrated Frontend & Go Refactoring Plan

> **Status:** Proposed code-refactoring plan. This document does not itself implement changes.
>
> **Delivery:** **ONE implementation branch, ONE implementation PR covering both FE and Go.** The steps below are internal checkpoints in that same PR, not separately deployed phases or PRs.
>
> **Goal:** Reduce cross-feature coupling, split oversized frontend components and Go services by responsibility, organize reusable code, and enforce dependency boundaries—**without changing application behavior**.
>
> **Architecture:** [Folder structure guide](folderStructure.md) is the source of truth for package ownership, naming and dependency direction.

## 1. Scope and constraints

**Included:** `apps/web/src`, `apps/api/internal`, colocated unit tests, Go integration tests, browser E2E tests, minimal import-boundary lint/CI rules, documentation and path updates required by the moves.

**Not included:** Product changes, API paths or schemas, database migrations, visual redesign, new framework, microservices or Clean Architecture, generic repositories, empty placeholder folders, hand edits to `apiTypes.generated.ts`, or changes to deployment behavior.

In particular, **Recurrence Edit/Delete "This and following"** is a *separate feature request*. During this structural refactor, preserve existing `one`/`all`/Stop behavior, even if it is scheduled to change later. Background Focus scheduling, Web Push, new Trash/history semantics and Settings validation changes are likewise out of scope.

### One-PR rule

- Do all FE and Go refactoring on **one implementation branch** with **one code PR**. Use internal checkpoints for testable progress; optional commits inside the PR are not separate release boundaries.
- Keep the implementation PR **unmerged until all planned work and full verification are complete**. If a task is unsafe or blocked, document it and request an explicit scope revision; do not silently mark a partial pass as complete.
- There is **no requirement to create separate FE, BE, test or lint PRs**. Do not combine the behavioral feature backlog with this organizational refactor.

## 2. Current areas to improve

### Frontend

| File | Approx. lines | Problem to address |
|---|---:|---|
| `home/components/homePage/homePage.tsx` | 1,170 | Navigation, query state, command handlers, calendar/focus and panel composition mixed |
| `features/tasks/components/taskEditor/taskEditor.tsx` | 674 | Draft persistence, mutation/retry, scope dialog and all form fields together |
| `features/tasks/components/taskDetail/taskDetail.tsx` | 388 | Information, Focus history, completion and deletion handling |
| `features/calendar/components/calendar/calendar.tsx` | 379 | FullCalendar instance, preview, event mapping, resize/drag and Focus integration |
| `features/focus/components/timerPanel/timerPanel.tsx` | 323 | Session display, task selection and control interactions |
| `home/components/homePage/homePage.module.css` | Large | Layout, workspace panels, sidebar and responsive styles in one file |

**Concrete coupling found:** TaskEditor imports `calendar/utils/draftPreview`; Calendar imports Task editor `Draft`/priority constants; CalendarEventContent imports the Task `PriorityBadge` and Focus hooks; several features deep-import Auth context/query hooks. Not all of these are runtime circular imports, but they make boundaries fragile.

### Go

| File | Approx. lines | Responsibility |
|---|---:|---|
| `services/recurrenceService.go` | 432 | Series create/read, materialize, edit, stop and restore |
| `services/planningService.go` | 309 | Finalize, settle, report, historical snapshot, timezone changes |
| `services/task.go` | 242 | Business errors, Task validation, lifecycle, events and exceptions |
| `services/focusService.go` | 234 | Focus sessions, interval time, settlement and history |
| `repository/recurrenceRepository.go` | 88 | Cohesive SQL owner; **do not split just for size** |
| `controllers/planning_test.go` | Large | Several planning-oriented test scenarios |

Controllers are already reasonably thin. Keep the Go **layer-first** architecture.

## 3. Final dependency and shared-code rules

### Frontend

```text
app → home → features → shared
                 └→ Auth public API (where legitimately needed)
```

- `shared` must never import `features`/`home`/`app`. Features must not import `home` or `app`.
- Cross-feature collaboration belongs in `home` via **narrow props and callbacks**, or through **stable public exports** when a genuine feature dependency is warranted. Avoid deep private-hook/component/type imports and accidental cycles.
- Promote to `shared` **only when at least two independent consumers need the same reusable mechanism** and the code has no feature-private dependencies.
- A component consuming two Focus actions should not require the entire `FocusController`. Keep Focus timing/remaining calculation single-owned.
- Keep one owner for form draft, API command, timers and session state. Moving JSX into children must not create redundant sources of truth.
- Auth session/query features may expose an `index.ts` as a public boundary. **Do not move `useOwnedQuery` unchanged into `shared`** because it imports `useSession`.
- Generated shared types remain sourced from `api/openapi.yaml`, not copied into each feature.

**Existing ownership decisions:**

| Code | Decision |
|---|---|
| `tasks/components/priorityBadge` | Move reusable badge, its CSS/test, to `shared/components/priorityBadge` |
| `tasks/constants/taskConstants` | Move shared priority labels only; keep task-specific constants in Tasks |
| `shared/components/dialog` / `toast` / `sidebarPanel` / `validatedForm` | Already in the right place |
| `shared/hooks/useCommand` / `useAccountDraft` | Keep generic command and draft infrastructure |
| `auth/hooks/useOwnedQuery` | Keep Auth-owned or refactor to an injected mechanism before promoting |
| `focus/hooks/useRemaining` / `focus/utils/clock` | Remain Focus-owned |
| `tasks/utils/taskPayload` | Remain Task-owned |
| `calendar/utils/draftPreview` | Remain Calendar-owned; remove dependency on Task editor's Draft type |

### Go

```text
router / middleware → controllers → services → repository → PostgreSQL
                          ↘ dto          ↘ models / localdate
workers ───────────────────────────────→ services
```

- Continue using existing `controllers`, `services` and `repository` packages. Split **files by cohesive workflow in the same package**; do not create one package for each business operation.
- HTTP decoding/encoding stays in controllers/DTO, business invariants in services, account-scoped SQL/scan in repository.
- No `repository → services`, `services → controllers/router` or `models → controllers/repository` import edges; no controller SQL or service HTTP response formatting.
- Use focused existing packages `localdate`, `database`, `monitoring`; do not create a generic Go `shared` or `utils`.
- Maintain `services.Execute`, `services.WithTx`, `database.WithTx` settings-row `FOR UPDATE` locking, bounded history catch-up, session revalidation, ownership and revision checks, idempotency receipts and atomic final command transaction.
- Repositories must not independently commit a step in a multi-step mutation. Worker must call service rules, not controllers.

## 4. Target organization (examples, not mandatory placeholders)

### Frontend

```text
apps/web/src/
├── app/                                 # Thin Next.js entry points
├── home/
│   ├── components/
│   │   ├── homePage/                    # Thin composition root
│   │   ├── workspaceLayout/             # Shell and layout
│   │   ├── workspaceSidebar/            # Navigation
│   │   └── workspacePanels/             # Task/Day/Focus panel composition
│   └── hooks/
│       ├── useWorkspaceNavigation.ts    # If cohesive
│       └── useTaskPanel.ts              # If cohesive
├── features/
│   ├── tasks/
│   │   ├── components/taskEditor/
│   │   │   ├── taskEditor.tsx
│   │   │   ├── taskBasicFields.tsx
│   │   │   ├── taskScheduleFields.tsx
│   │   │   ├── taskFocusFields.tsx
│   │   │   └── recurringScopeDialog.tsx
│   │   ├── hooks/
│   │   │   ├── useTaskEditorDraft.ts
│   │   │   └── useTaskEditorSave.ts
│   │   └── utils/
│   ├── calendar/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── utils/mapCalendarEvents.ts
│   ├── focus/
│   ├── auth/
│   ├── analytics/
│   └── settings/
└── shared/
    ├── api/
    ├── components/priorityBadge/        # Reused Task/Calendar UI
    ├── constants/                       # Only genuinely shared constants
    ├── hooks/
    ├── utils/
    └── styles/
```

Each styled component owns a colocated CSS Module and focused tests. No arbitrary 200-line maximum; use **cohesion, independent testability and single-responsibility ownership** as the extraction rule.

### Go

```text
apps/api/internal/
├── controllers/                         # Existing thin HTTP layer
├── services/
│   ├── commands.go                      # Existing Execute / View frame
│   ├── errors.go                        # If error helpers warrant extraction
│   ├── recurrenceCreation.go            # Create / read series
│   ├── recurrenceMaterialization.go     # Slots, exceptions, guards
│   ├── recurrenceEditing.go             # Existing UpdateFromTask behavior
│   ├── recurrenceStopping.go            # Stop and restore
│   ├── planningSnapshot.go              # Finalize / snapshot entries
│   ├── planningSettlement.go            # Settle / WithTx / zone changes
│   ├── planningReport.go                # DayReport / DayAt
│   ├── taskValidation.go                # Task input rules
│   ├── taskLifecycle.go                 # Create/update/complete/delete
│   ├── taskEvents.go                    # Journal and recurrence exceptions
│   ├── focusService.go                  # Focus entry points
│   └── focusSettlement.go               # Only when cohesive
├── repository/                          # Keep SQL ownership
├── models/
├── database/
└── workers/
```

Keep exported Go entry points stable, avoid duplicate functions, and do not move SQL into service or controller code.

## 5. ONE integrated implementation sequence

The numbered steps below are **checkpoints within one implementation PR**. Work through them in order for easier debugging. You may make incremental commits, but **do not open separate PRs or deploy intermediate refactor states**.

### Step 0 — Baseline and characterization tests

- [ ] Inventory current FE import graph, Go package graph, file owners, CSS selectors and test coverage.
- [ ] Capture passing and failing baseline commands. A blocked/untested command is not a pass.
- [ ] Add characterization tests for Task draft/retry, calendar drag/Undo, Focus clock synchronization; recurrence create/materialize/edit/stop/restore; planning finalization/zone changes; revision/idempotency.
- [ ] Keep current API/UX semantics frozen and use deterministic dates, timezone/DST fixtures where needed.

### Step 1 — FE dependency cleanup and shared promotion

- [ ] Remove `TaskEditor → calendar/draftPreview`: editor emits Task `Draft`, `home` adapts preview input.
- [ ] Remove `Calendar → TaskEditor Draft`, use a narrow Calendar-owned create/preview input.
- [ ] Move reusable `PriorityBadge` and its styles/tests to `shared`; extract shared priority labels only.
- [ ] Replace direct Calendar imports of Focus private hooks and entire `FocusController` with a small view/actions contract; preserve one countdown anchor.
- [ ] Add public Auth exports or inject narrow authenticated capabilities; avoid moving Auth-dependent hooks directly to `shared`.
- [ ] Confirm no `shared → features` or feature cycles.

### Step 2 — FE components/hooks/CSS decomposition

- [ ] Split `homePage.tsx` into workspace layout, sidebar/navigation, panels and related focused hooks; avoid creating a mega-hook.
- [ ] Split `taskEditor.tsx` into field sections and recurrence dialog; extract draft and save workflows without duplicating state or losing saved draft/uncertain command.
- [ ] Separate Calendar event conversion, interaction mapping and FullCalendar component responsibility without changing 15-minute snapping or DST behavior.
- [ ] Extract coherent TaskDetail sections and TimerPanel presentation/task-selection controls as useful.
- [ ] Colocate CSS Modules and component tests; keep FullCalendar overrides scoped under the Calendar wrapper.
- [ ] Test keyboard focus/escape, responsive layout, light/dark mode, preview dismissal and cross-device timer behavior.

### Step 3 — Go recurrence and planning file extraction

- [ ] Split `recurrenceService.go` into creation/read, materialization, editing and stop/restore workflows **without changing existing recurrence scopes**.
- [ ] Preserve stable original-slot identity, tombstones/exceptions, DST guards, historical and Focus links, revisions and idempotency.
- [ ] Split `planningService.go` into snapshot/finalization, settlement/transactions/zone changes and day/report helpers.
- [ ] Preserve bounded catch-up batches, historical adjustments, account locking and final transaction semantics.

### Step 4 — Go task/Focus and tests

- [ ] Separate `task.go` into validation, lifecycle, events and recurrence-exception helpers; only deduplicate truly identical semantics.
- [ ] Preserve task events before/after states, completion attribution, soft deletion/restore, stale revisions and historical recount.
- [ ] Extract Focus settlement helpers only if they improve cohesion. Preserve intervals, active-session exclusivity, pause/resume/end, logical completion and Pomodoro counting.
- [ ] Leave cohesive repository SQL in `repository`; do not add new generic abstractions.
- [ ] Split oversized test files by scenario only if navigation and isolation improve; keep fixtures focused.

### Step 5 — Architecture enforcement and end-to-end integration

- [ ] Add FE import lint/analysis for `shared → features/home/app`, `features → home/app` and circular dependencies; document legitimate public Auth dependencies.
- [ ] Add lightweight Go package checks for forbidden layer edges (e.g. via `go list`); compiler already catches package cycles but not architecture policy.
- [ ] Update affected imports, CSS references, test discovery, CI/scripts and documentation paths; no stale or duplicate implementations.
- [ ] Run **all** FE and Go checks on the **complete combined branch** and fix any cross-module regressions.
- [ ] Review the full **single PR** diff for unrelated formatting, generated files, accidental API/schema changes and feature work.

## 6. Required regression matrix

| Area | Must preserve |
|---|---|
| Auth | Login/logout/session expiry, private cache, account-owned draft restoration |
| Tasks | Validation, completedAt, edit/delete/restore, revision checks, before/after journal, uncertain same-key retry |
| Recurrence | **Current** `one`/`all`/Stop behavior, original-slot identity, DST exceptions, no duplicate materialization |
| Calendar | Day/Week/Month, drag/resize, 15-minute snapping, draft preview, overall progress |
| Undo | Server-enforced 10-second schedule token and revision conflicts |
| Focus | Single active session, accurate elapsed intervals, one Pomodoro on completion, synced multiple displays, no automatic Task completion |
| Planning / Analytics | Finalized snapshots, explicit historical adjustments, `No plan` vs `0%`, weighted rollup and Focus history |
| Transaction | Account row lock, bounded settlement, ownership, atomic receipt and rollback |
| Worker | Service-owned behavior; worker lifecycle cannot bypass transaction safeguards |
| UI quality | Accessibility, dialog focus, keyboard actions, FullCalendar/CSS Modules, responsive light/dark |
| Public contract | Unchanged routes/JSON, migration history, OpenAPI and generated type outputs |

## 7. Verification before merging

Run against the **integrated single implementation PR** after completing all steps:

```bash
make test-go
make test-integration
make build-api
make build-worker
(cd apps/api && go vet ./...)

make typecheck
make test-web
make build-web
make test-e2e
(cd apps/web && npm run format:check)
```

- Also run the introduced FE/Go architecture checks; prove they reject an intentionally invalid edge in an isolated test.
- Verify UI visually: calendar placement/drag, panel focus return, draft restore, light/dark, responsive behavior and FullCalendar overrides.
- Real database tests must use isolated `*_test` databases, never production or development data. Avoid concurrent E2E suites on shared test ports/DB.
- Record actual commands and outcomes. No successful merge based solely on build/typecheck while E2E or integration is blocked.

## 8. Definition of done — ONE code PR

- [ ] All FE + Go refactor tasks in **one** implementation branch and **one** code PR; no partial deployment or merge.
- [ ] No user-visible change, API/schema/migration change, new feature or changed recurrence behavior.
- [ ] Shared and feature dependency rules pass checks; no circular FE imports or Go forbidden package edges.
- [ ] Components/hooks/styles owned correctly with one source of state and colocated tests.
- [ ] Go service workflows cohesive; exported entry points and transactional invariants intact.
- [ ] All Go, frontend, E2E, CI lint and architectural tests pass with documented output.
- [ ] No unused duplicate files, speculative abstractions, unrelated reformatting or manual generated-type edits.
- [ ] Final file layout matches [folderStructure.md](folderStructure.md); update that guide only to reflect real ownership changes.
- [ ] Consolidated PR description lists moved files, intentional exceptions, risks and verification results.

## 9. Deferred product changes and references

Changes to recurring **This and following** edit/delete, persistent Focus completion/Web Push, Trash recovery, immutable historical baselines and settings-duration validation are **outside this structural refactor**. Track them in `docs/features/16-implementation-backlog.md` from [feature documentation PR #12](https://github.com/Walker-mfj/TodoCal/pull/12); do not treat unmerged proposals as shipped features.

See [Folder structure](folderStructure.md), [Feature documents](../features/README.md), [API contract](../../api/openapi.yaml), [Project README](../../README.md), and [Deployment guide](../../deploy/README.md).

**Maintenance:** Track actual completion and test evidence in the eventual **single code PR**. This plan is a scope/acceptance contract, not a duplicate of product specs.
