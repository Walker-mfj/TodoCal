# TodoCal — Frontend Refactoring Plan

> **Status:** Proposed implementation plan. No refactor tasks described here have been implemented by this documentation change.
>
> **Goal:** Reduce cross-feature coupling, make large components maintainable, and place genuinely reusable UI/infrastructure in `shared` without altering user-visible behavior.
>
> **Scope:** `apps/web/src`, local component tests, Playwright flows, import-boundary checks and the minimum supporting tooling. Preserve the approved **feature-first** architecture.

## 1. Principles and non-goals

### Principles

1. **Own code by feature.** Domain UI, hooks, validation, types and constants stay with their feature unless a reusable *mechanism* demonstrably serves several features.
2. **Prefer explicit boundaries.** `app → home → features → shared` is the intended high-level dependency direction. `shared` must never depend on `features`, `home` or `app`.
3. **Coordinate in `home`.** Cross-feature workflows can pass small props/callbacks rather than importing another feature's private hook or component.
4. **Separate orchestration from presentation.** Move coherent stateful workflows into appropriately owned hooks; extract UI sections when they can be reasoned about/tested independently.
5. **Avoid duplicate state.** Keep one authoritative draft/controller per workflow; child field components receive values and callbacks instead of managing a second, unsynchronized copy.
6. **Keep refactors behavior-preserving.** Make product changes in separate PRs with independent requirements and acceptance tests.

### Non-goals

- Do **not** switch the frontend to a generic layer-first / Clean Architecture folder structure or add a design-system framework simply to move files.
- Do **not** move everything reused once into `shared`, add catch-all `helpers` / `common` folders, or create placeholder `components` / `hooks` / `types` directories.
- Do **not** change navigation, calendar interactions, styles, API routes/payloads, session semantics, Focus counts, recurrence scopes, notification behavior or database rules.
- Do **not** implement **Edit/Delete This and following** recurrence here. That is a separate functional change; this refactor must preserve the existing scope behavior until the recurrence PR ships.
- Do **not** edit `apiTypes.generated.ts` by hand or split it because its generated file is large.

## 2. Current code observations

| Existing file | Approx. lines | Responsibilities / coupling | Priority |
|---|---:|---|---|
| `home/components/homePage/homePage.tsx` | 1,170 | Navigation, data queries, filters, task commands, recurrence confirmations, Focus, panel composition and layout | P1 |
| `features/tasks/components/taskEditor/taskEditor.tsx` | 674 | Task draft persistence, validation, saving/retry, recurrence scope and form sections | P1 |
| `features/tasks/components/taskDetail/taskDetail.tsx` | 388 | Task details, historical information, Focus history, completion and deletion/stop dialogs | P2 |
| `features/calendar/components/calendar/calendar.tsx` | 379 | FullCalendar adapter, task→event mapping, draft preview, drag/drop, resize, day progress and Focus integration | P2 |
| `features/focus/components/timerPanel/timerPanel.tsx` | 323 | Session display, task selection, controls and state-dependent UI | P2 |
| `home/components/homePage/homePage.module.css` | Large | Navigation, workspace, cards, panels, reports and responsive styles in one module | P1 alongside component split |

A file size is only a signal. **Cohesion and testability** determine whether an extraction is worthwhile; there is no enforced 200-line cap.

### Specific cross-feature imports to remove or narrow

| Current edge | Why it is troublesome | Target boundary |
|---|---|---|
| `tasks/taskEditor → calendar/utils/draftPreview` | Task form depends on the Calendar representation of its draft | Task editor emits a Task-owned `Draft`; `home` adapts it to a Calendar preview input |
| `calendar/calendar → tasks/types/taskTypes` | Calendar needs the editor's full `Draft` type | Define a narrow calendar-create/preview input owned by Calendar; map from Task draft at the `home` boundary |
| `calendar/calendar → tasks/constants/taskConstants` | Priority labels belong to neither Calendar nor Task editor alone | Share presentation constants (and their UI) only if used by multiple features |
| `calendar/eventContent → tasks/components/priorityBadge` | Calendar imports a deep Task component | Move reusable `PriorityBadge` to `shared/components/priorityBadge` with a small public prop type |
| `calendar/calendar` and `calendar/eventContent → focus/hooks/useFocus` | Calendar knows the entire `FocusController`, including command/retry/permission internals it should not need | Pass a **minimal typed Focus view** and actions via props, composed by `home` |
| `calendar/eventContent → focus/hooks/useRemaining` | Calendar reaches into a private Focus timer hook | Prefer a Focus-owned minimal display/action adapter or pass elapsed/remaining information from a public Focus controller; keep the timer calculation owned by Focus, not copy it into Calendar |
| `tasks/taskDetail → auth/hooks/useOwnedQuery`; `focus/useFocus → auth/hooks/useOwnedQuery` | Features depend on auth's internal file layout | Expose stable feature-level auth public APIs, or introduce a shared query hook **only after** decoupling it from auth internals |
| `focus/timerPanel → auth/components/sessionProvider`; `calendar/useSchedule → auth/components/sessionProvider` | Deep imports of auth context | Route through a stable auth export or inject a narrow read/execute/session capability |

**Allowed exception:** Multiple features legitimately need account/session capabilities from Auth. The goal is not to ban all feature→auth imports, but to **ban accidental deep/private coupling** and circular feature dependencies. Prefer explicit auth exports or dependency injection; do not move account-specific logic blindly into `shared`.

## 3. Target structure (illustrative, not a mass rename)

```text
apps/web/src/
├── app/
│   └── providers.tsx
├── home/
│   ├── components/
│   │   ├── homePage/
│   │   │   └── homePage.tsx           # Thin composition root
│   │   ├── workspaceLayout/          # App shell, responsive regions
│   │   ├── workspaceSidebar/         # Navigation and account controls
│   │   ├── workspaceToolbar/         # Filters and global actions (if cohesive)
│   │   └── workspacePanels/          # Panel composition
│   └── hooks/
│       ├── useWorkspaceNavigation.ts
│       └── useTaskPanel.ts
├── features/
│   ├── tasks/
│   │   ├── components/
│   │   │   └── taskEditor/
│   │   │       ├── taskEditor.tsx
│   │   │       ├── taskBasicFields.tsx
│   │   │       ├── taskScheduleFields.tsx
│   │   │       ├── taskFocusFields.tsx
│   │   │       └── recurringScopeDialog.tsx
│   │   ├── hooks/
│   │   │   ├── useTaskEditorDraft.ts
│   │   │   └── useTaskEditorSave.ts
│   │   ├── types/
│   │   └── utils/
│   ├── calendar/
│   │   ├── components/
│   │   ├── hooks/                   # Calendar-owned interaction coordination
│   │   └── utils/
│   │       └── mapCalendarEvents.ts  # Task/day → FullCalendar events
│   ├── focus/
│   ├── auth/
│   ├── analytics/
│   └── settings/
└── shared/
    ├── api/
    ├── components/
    │   └── priorityBadge/          # If reused across Task/Calendar
    ├── constants/                   # Only truly cross-feature constants
    ├── hooks/
    ├── types/                       # Only mechanism-level types
    ├── utils/
    └── styles/
```

Create each target file **only when moving a coherent implementation and its tests**. Do not pre-create all example folders. Component-specific CSS should move with its component; a component without unique styles needs no empty `.module.css`.

## 4. Shared ownership policy

### Move or reuse

| Candidate | Preferred decision | Reason |
|---|---|---|
| `features/tasks/components/priorityBadge` | Move to `shared/components/priorityBadge` if Task and Calendar both consume it | Reusable priority presentation, no task-form state |
| `features/tasks/constants/taskConstants.ts` | Move only the shared priority labels to a clear shared location | Prevent Calendar importing Task internals; keep task-only constants in Tasks |
| `shared/components/dialog`, `toast`, `sidebarPanel`, `validatedForm` | Keep in `shared` | Already reusable across features |
| `shared/hooks/useCommand` and `useAccountDraft` | Keep in `shared` | Shared mutation/draft mechanisms |
| `features/auth/hooks/useOwnedQuery` | **Do not move unchanged** | It calls `useSession` from Auth; a straight move would introduce forbidden `shared → auth` dependency |
| `features/focus/hooks/useRemaining` and `focus/utils/clock` | Keep in Focus | Focus-specific lifecycle/clock semantics |
| `features/tasks/utils/taskPayload` | Keep in Tasks | Task-specific form-to-API validation |
| `features/calendar/utils/draftPreview` | Keep in Calendar, but narrow its input interface | FullCalendar event conversion is a Calendar responsibility |
| `shared/api/domainTypes` / `apiTypes.generated` | Keep in `shared/api` | Common server models and generated schema |

**Promotion test:** Before moving a component/hook/helper to `shared`, verify it serves **at least two independent consumers**, has no feature-private dependencies, and its API can be explained without mentioning a particular page. If not, retain it in its owner feature. Shared does **not** mean all business concepts must be relocated into one global folder.

### Auth/query boundary alternatives

Option A (minimal): `auth` exports a stable `index.ts` with `useSession`, `useOwnedQuery` and public auth types. Other features import the public entry point rather than internal paths. Keep dependency direction explicit.

Option B (later, if beneficial): move only a **generic** query mechanism to `shared/hooks`, injecting the typed `read` function, account ID, and enabled flag. Auth owns wiring of session/read; shared must never import Auth. Avoid double-fetching or changing query keys.

Prefer **Option A for the first cleanup PR**; defer Option B unless recurring needs justify the extra abstraction.

## 5. Delivery plan — small behavior-preserving PRs

### PR FE-0 — Inventory and characterization tests (P0)

- Inventory actual import edges between `home`, `tasks`, `calendar`, `focus` and `auth`, including type-only imports and deep exports.
- Record baseline typecheck, unit/component tests, E2E and screenshots for key views.
- Add tests where behavior is insufficiently pinned down: scheduling 10-second Undo, calendar draft preview and clearing, task editor unsaved/uncertain payload recovery, recurrence scope confirmation, Focus pause/resume/cross-device display.
- Capture state and callbacks before extracting components so a pass/fail can be attributed to structure, not a product change.

**Done:** A documented dependency graph, passing baseline and no UI/contract change.

### PR FE-1 — Remove feature import cycles and shrink cross-feature contracts (P1)

- Decouple `TaskEditor` from `calendar/utils/draftPreview`: emit a Task draft; `home` assembles calendar preview data.
- Change Calendar's `onCreate` / preview input to a minimal Calendar-owned payload, not a full Task editor `Draft` import.
- Move `PriorityBadge` and shared priority presentation labels only after verifying all consumers; update Task and Calendar imports.
- Replace Calendar's large `FocusController` dependency with a small, explicit view/actions contract. Keep Focus remaining-time calculation in the correct owner; **do not reset timers or duplicate clocks**.
- Provide a stable Auth public entry point for cross-feature session/query consumers, or inject the minimum dependencies.
- Keep typed `Task` / `Group` / `Day` models sourced from `shared/api`.

**Done:** No tasks↔calendar import cycle, no Calendar import of deep Task/Focus implementation, no `shared → feature` imports; all focus/schedule/preview tests pass.

### PR FE-2 — Decompose `homePage.tsx` and its styles (P1)

- Extract workspace shell/navigation/toolbar into local `home/components` with focused props.
- Extract `workspacePanels` to render TaskEditor, TaskDetail, Day details and other panels; `home` remains the cross-feature composition owner.
- Extract `useWorkspaceNavigation` for page, filters and account-scoped navigation persistence when cohesive; use `useTaskPanel` for opening, closing, discard-draft confirm and panel state.
- Keep domain queries and commands in their features or dedicated orchestration hooks; avoid moving 1,000 lines into one new `useHomePage` mega-hook.
- Move sidebar/panel/toolbar CSS from `homePage.module.css` to colocated modules in the same PR as their JSX.

**Done:** `HomePage` primarily wires child sections and business callbacks; no duplicate session/account state, preserved responsive layout, keyboard focus, light/dark and navigation behavior.

### PR FE-3 — Decompose `TaskEditor` by ownership (P1)

- Extract purely presentational `taskBasicFields`, `taskScheduleFields` and `taskFocusFields`; keep field-level accessibility labels, validation messages and CSS ownership.
- Extract `recurringScopeDialog` but **retain the current API scope semantics** during this refactor.
- Separate `useTaskEditorDraft` (baseline, dirty, sessionStorage and preview feedback) from `useTaskEditorSave` (request/payload, idempotency key, revision, conflict and retry recovery).
- Keep **one** source of truth for the editable draft. On failure or 409 preserve the exact form values; on uncertain retries reuse the exact original request body and key.
- Use existing `taskPayload` for task-specific validation, not new shared rules.

**Done:** Editing, draft restore, calendar preview, recurrence confirmation, Escape/discard and saved task behavior remain identical.

### PR FE-4 — Calendar, TaskDetail and Focus presentation cleanup (P2)

- Calendar: move event mapping into a pure utility `mapCalendarEvents`, keep FullCalendar API/resize observation in the component or a dedicated hook only if cohesive. Isolate drag/resize and slot-draft conversion without changing date/DST/snap behavior.
- TaskDetail: split focused presentation such as information, Focus history, completion-date controls and deletion/stop confirmation where they have independent responsibility. Keep task mutation/revision behavior server-authoritative.
- TimerPanel: consider extracting task chooser, timer display and action controls. Keep `useFocus` as the single controller for active sessions; a later-mounting clock must use the same server snapshot anchor.
- Keep feature-owned CSS and `:global(...)` FullCalendar overrides scoped under the local calendar wrapper.

**Done:** Reduced component cognitive load, no duplicate side effects or session state, no regressions in event drag/resize, panel dialogs or Focus duration.

### PR FE-5 — Enforce boundaries and add focused tests (P2)

- Add lint/checking that **rejects** `shared → features/home/app` and `features → home/app` and detects circular imports. Treat `auth` as an explicitly documented **public dependency** rather than silently banning all auth usage.
- Discourage deep cross-feature imports: `feature A → feature B/privateComponent` requires a clear exception or a public-facing boundary.
- Leverage the existing `@/*` TS path alias for readability if desired, but aliasing does **not** enforce architecture. Avoid unrelated mass import rewrites.
- Add CI checks in a staged rollout: first detect and report existing violations, then enable failure after approved edges are cleaned up.
- Keep tests colocated (`*.test.ts(x)`) and browser flows under `apps/web/tests/e2e`. Verify that TypeScript aliases, Vitest and Playwright all resolve any introduced public entry points.

**Done:** CI fails on a deliberately introduced forbidden import; current code passes the final rule set without blanket ignores.

## 6. Regression matrix

| Area | Must remain unchanged |
|---|---|
| Auth and account switching | Session expiry, logout, account-scoped query keys, no cross-account cached/draft data |
| Task editor | Field validation, draft restoration, stable unsaved state, exact idempotency retry and revision conflict handling |
| Recurrence | Current single/all/stop behavior, until the separate `This and following` product change |
| Calendar | Day/Week/Month event layout, 15-minute drag snapping, resizing, DST validation, filter behavior and progress |
| Schedule Undo | Server-enforced 10-second token; stale revision invalidates Undo |
| Focus | Server-authoritative session, pause/resume/early end, one active session, shared timer anchor and no automatic task completion |
| Progress and analytics | `No plan` versus `0%`, weighted totals, historical drilldown and filter-independent overall progress |
| Accessibility | Keyboard focus, dialog escape/focus return, error announcements, touch and responsive behavior |
| Styling | CSS Modules isolation, FullCalendar overrides, dark/light mode, media queries and portal layers |
| Data contracts | No accidental endpoint/payload/API generated-type changes |

Use existing E2E tests as primary proof of cross-feature UX. Add narrower component/hook tests for extracted controllers and a visual comparison where CSS moves.

## 7. Verification commands

Run for **every relevant FE PR**:

```bash
make typecheck
make test-web
make build-web
```

For high-impact composition/CSS/calendar/Focus changes:

```bash
make test-e2e
cd apps/web && npm run format:check
```

When an API contract was intentionally changed in a **separate** functional PR, regenerate types through `make generate-api-types`; this frontend structural refactor should not require API changes or manual edits to `apiTypes.generated.ts`.

A pass in TypeScript/Vitest is **not** proof that keyboard focus, calendar event layout, dark mode, responsive behavior or persisted drafts are correct. Use the existing browser suite and targeted visual inspection.

## 8. Definition of done (each PR)

- [ ] No user-visible behavior change, API contract change or new product feature.
- [ ] Feature owners and dependency direction are clear; no accidental circular import or `shared → feature` edge.
- [ ] No state duplication, stale closures or unintended fetches caused by moving hooks.
- [ ] Colocated CSS Modules for extracted styled components; no feature-specific styles added to `globals.css`.
- [ ] Cross-feature callbacks/interfaces are small; no UI component requires an entire foreign feature controller if it needs only two actions.
- [ ] Unit/component tests are colocated with their owner and cover the extracted behavior.
- [ ] Relevant E2E flows pass for auth, tasks, calendar, recurrence, Focus and accessibility.
- [ ] Typecheck and production build pass; existing generated API types untouched unless contract change is separately approved.
- [ ] No placeholders, speculative shared abstractions, unrelated formatting or broad renames.
- [ ] PR lists moved files, any permitted import exceptions and exact verification commands/results.

## 9. Deferred business changes and related docs

The following are **outside** this structural refactor, even when they touch the same code:
- Recurring **Edit/Delete This and following** behavior.
- Background Focus completion, scheduled reminders or Web Push.
- Trash/retention policy, immutable original-history snapshots and Settings validation changes.

See the feature implementation backlog (`docs/features/16-implementation-backlog.md`, tracked in [PR #12](https://github.com/Walker-mfj/TodoCal/pull/12)) when that feature document is available on the target branch. A proposed feature is **not** considered shipped merely because its UI/component was reorganized.

### Related

- [Folder structure guide](folderStructure.md) — ownership and naming rules.
- [Go backend refactoring plan](goRefactoringPlan.md) — counterpart plan for Go.
- [Feature documentation](../features/README.md) — current product behavior.
- [API contract](../../api/openapi.yaml) — source for generated types.
- [Developer commands](../../README.md) — standard test/build commands.

**Maintenance:** Track completion and deviations in each code PR. Keep this file focused on refactoring order, boundaries and acceptance criteria, not a duplicate of the full product spec.
