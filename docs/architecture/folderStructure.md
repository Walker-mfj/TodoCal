# TodoCal — Folder Structure Guide

> **Purpose:** A practical reference for file placement, module ownership, and dependency boundaries.

## 1. Core decisions

| Area | Rule |
|---|---|
| Repository | Keep one monorepo with `apps/web` (Next.js) and `apps/api` (Go) |
| Frontend | **Feature-first:** code for a feature lives together; use `components`, `hooks`, `utils`, `types`, `constants` as needed |
| Component styling | A styled component owns a colocated `.module.css` file; no shared dumping ground for component-specific CSS |
| Main screen | `home` composes the workspace; browser route remains `/` |
| Backend | **Layer-first** directly under `internal`: `controllers` → `services` → `repository` |
| File/folder names | Custom names use **camelCase**; React component/type identifiers use PascalCase |
| CSS selectors | Custom CSS classes use **kebab-case** |
| Change policy | Document boundaries before structural refactors; retain user behavior, API/URL contracts and data |

**Why this design?** Feature-first keeps frontend UI and its helpers close. Layer-first makes the backend's request-to-database flow explicit. Do **not** introduce extra domain layers, generic repositories or monorepo tools for cosmetic symmetry.

## 2. Top-level repository

```text
TodoCal/
├── .github/workflows/            CI and frontend deploy
├── api/openapi.yaml              Public REST contract; generated web types
├── apps/
│   ├── web/                      Next.js user interface
│   └── api/                      Go REST API with embedded scheduler
├── deploy/
│   ├── cloudflare/               Frontend build, reverse proxy, Wrangler
│   ├── README.md
│   └── monitoring.md
├── docs/
│   ├── architecture/             Cross-cutting engineering conventions
│   └── features/                 Feature behavior and acceptance contracts
├── scripts/                      Integration, E2E, load, operations
├── compose.yaml                  Local PostgreSQL
├── Makefile                      Local build/test/dev entry points
└── README.md                     Start here
```

Only show folders with real contents. A listed `hooks/` or `types/` directory is **optional**, not a placeholder to create for every feature.

## 3. Frontend: `apps/web`

### Structure

```text
apps/web/
├── src/
│   ├── app/
│   │   ├── page.tsx              / route; renders HomePage
│   │   ├── layout.tsx
│   │   ├── providers.tsx         Composes global providers
│   │   └── manifest.ts           Framework-owned PWA metadata
│   ├── home/
│   │   └── components/
│   │       └── homePage/
│   │           ├── homePage.tsx
│   │           └── homePage.module.css
│   ├── features/
│   │   ├── auth/
│   │   ├── tasks/
│   │   │   ├── components/
│   │   │   │   └── taskEditor/
│   │   │   │       ├── taskEditor.tsx
│   │   │   │       ├── taskEditor.module.css
│   │   │   │       └── taskEditor.test.tsx
│   │   │   ├── hooks/            If needed
│   │   │   ├── utils/
│   │   │   ├── types/
│   │   │   └── constants/
│   │   ├── calendar/
│   │   ├── focus/
│   │   ├── analytics/
│   │   └── settings/
│   └── shared/
│       ├── api/
│       ├── components/
│       ├── hooks/
│       ├── utils/
│       └── styles/
│           ├── reset.css
│           ├── tokens.css
│           └── globals.css
├── assets/                       Imported brand/icons
└── tests/
    ├── e2e/                      Full Playwright workflows
    └── setup.ts                   Shared test setup
```

The workspace shell, sidebar, heading, task list, filters, progress and day details have component-owned modules under `home/components`. Task editor draft/save hooks live under `features/tasks/hooks`; Calendar event/interaction mapping stays under `features/calendar/utils`. Feature `index.ts` files form deliberate public boundaries.

### Ownership and dependencies

| Location | Owns |
|---|---|
| `app/` | Next.js routes, layout, metadata, error boundaries, provider composition; **no domain logic** |
| `home/` | Main workspace layout, navigation and feature composition; **not** a separate `/home` route |
| `features/<feature>/components/` | UI, handlers and component-owned styles |
| `features/<feature>/hooks/` | React effects, feature queries, mutations and lifecycle |
| `features/<feature>/utils/` | Pure validation, payload transformations and calculations |
| `features/<feature>/types/` | Feature-local types; reuse OpenAPI-generated types rather than copy them |
| `features/<feature>/constants/` | Meaningful shared feature constants; not every literal |
| `shared/` | Reusable components, hooks, styles, API transport and utilities across features |

```text
app/ → home/ → features/ → shared/
                        └──────→ shared/api/
```

- **`shared` must never import `features`, `home` or `app`.** Features must not import `home` or `app`.
- Compose cross-feature workflows in `home` where possible; avoid deep imports of private components, hooks and editor-only types across features. Prefer small props/callbacks or a stable public feature API for deliberate dependencies; avoid circular feature imports.
- **Promote code to `shared` only after real reuse:** it must serve multiple independent consumers and have no dependency on feature-private logic. Keep Task, Calendar and Focus business-specific behavior with its owning feature.
- Session provider and authentication hooks live in `features/auth`. Provider *wiring* stays in `app/providers.tsx`. Auth access across features may use stable public exports; do not move `useOwnedQuery` unchanged into `shared` while it imports Auth. Shared query infrastructure must not import auth just to get a session.
- The server owns task state, recurrence, scheduling, Focus time and analytics. React may manage drafts, UI state and cache invalidation, not duplicate server-authoritative business rules.
- `apiTypes.generated.ts` is generated from `api/openapi.yaml`; **never edit generated types directly**.

### Styling rules

1. **Colocation:** `taskEditor.module.css` belongs beside `taskEditor.tsx`; a component with no unique styles does not require an empty CSS file.
2. **CSS class casing:** use kebab-case, e.g. `.task-title` and `.is-active`. With CSS Modules, reference as `styles["task-title"]` (or the repository's existing class-name binding helper).
3. **Global stylesheet scope:** `tokens.css` owns tokens/theme, `reset.css` owns reset, `globals.css` owns document foundations (e.g. `html`/`body`). Shared buttons, dialogs and toasts should own their module styles, not add component selectors to globals.
4. **Third-party styling:** scope FullCalendar overrides **inside the owning Calendar CSS Module**, under a local wrapper and only use `:global(...)` for third-party class selectors. Do not style all calendars globally.
5. **Regression checks:** dark/light mode, breakpoints, portal/dialog stacking, hover/focus states, drag-and-drop and Calendar rendering. Dynamic values may use CSS custom properties or inline styles; static layout rules belong in CSS Modules.

### Testing

- Keep unit/component tests **next to the implementation** (`*.test.ts` / `*.test.tsx`).
- Keep E2E workflows in `apps/web/tests/e2e/` and shared setup in `tests/setup.ts`.
- New/relocated tests must be discoverable by Vitest; do not rely on their old directory.
- A component split is not complete until it builds, typechecks and preserves its visible states. Split by coherent responsibility, not an arbitrary line limit; preserve one owner for drafts, session state and commands. Move styles and tests with the owning component.

## 4. Backend: `apps/api`

### Structure

```text
apps/api/
├── cmd/
│   └── api/main.go                API and embedded scheduler startup
└── internal/
    ├── router/                    Route registration
    ├── middleware/                HTTP security, proxy, request policies
    ├── controllers/               HTTP handlers and response mapping
    ├── dto/                       Request/response parsing
    ├── services/                  Business rules + orchestration
    ├── repository/                SQL queries + scanning/mapping
    ├── models/                    Shared domain/data structures
    ├── database/
    │   ├── migrate.go
    │   ├── transaction.go
    │   └── migrations/            Versioned SQL up/down
    ├── workers/                   Background execution orchestration
    ├── config/                    Configuration
    ├── monitoring/                Error reporting / redaction
    └── localdate/                 Time-zone/calendar-date helpers
```

Recurrence is split into `recurrenceCreation`, `recurrenceMaterialization`, `recurrenceEditing` and `recurrenceStopping`; planning uses `planningReport`, `planningSnapshot` and `planningSettlement`. Task validation/lifecycle/events and Focus settlement are separated within the same `services` package. Exported entry points and transaction ownership remain unchanged.

### Layer responsibilities

| Layer | Do | Do not |
|---|---|---|
| `router/` | Register API paths/methods | Business calculations or SQL |
| `middleware/` | HTTP security, origin/proxy headers, request policies | Task/repetition rules |
| `controllers/` | Decode input, access authenticated identity, call services, map output/errors to HTTP | Own transactions, write SQL |
| `dto/` | Boundary request/response shapes and parsing | Persist data |
| `services/` | Validate business rules, enforce ownership/revisions, orchestrate transactions, history and recurrence | Depend on `http.ResponseWriter`, controllers or router |
| `repository/` | Account-scoped SQL, row scans/mappers | Choose HTTP status or UI presentation |
| `models/` | Shared types and business-neutral result structures | Import controllers, repository or database |
| `database/` | Connection/migrations, shared transaction machinery | Define task-specific behavior |
| `workers/` | Schedule and execute background work through services | Call HTTP controllers as business helpers |
| `cmd/` | Initialize config and wire executables | Accumulate business logic |

```text
router → controllers → services → repository → PostgreSQL
           ↕ DTO         ↕ models      ↕ database transaction
```

**Invariant:** a multi-step operation uses **one service-managed transaction** with shared repository access. A repository must not partially commit a workflow. Idempotency receipts, account ownership, optimistic revision checks, undo, planning settlement and Focus integrity must survive refactors.

**Current implementation detail (verified):** `database.WithTx` locks the account's `settings` row using `SELECT ... FOR UPDATE`. `services.WithTx` can commit bounded catch-up batches before the final user-command transaction. Do not confuse this mechanism with a PostgreSQL advisory lock. Worker and HTTP operations follow the same service-level rules.

For testability, define small interfaces **at the consumer only when needed**; don't introduce an interface for every query or a generic repository framework. Split oversized Go service **files by workflow within the existing `services` package**, preserving exported signatures and transaction boundaries. Keep `*_test.go` adjacent to its package; use isolated database integration tests to verify transaction rollback and account isolation.

## 5. Naming conventions and exceptions

| Item | Preferred convention | Example |
|---|---|---|
| Custom folder/file | `camelCase` | `taskEditor/`, `taskPayload.ts`, `taskCommands.go` |
| React component / TS type | `PascalCase` identifier | `TaskEditor`, `FocusState` |
| React hook | `useXxx` | `useFocus.ts` |
| CSS Module | Component name + `.module.css` | `timerPanel.module.css` |
| Custom CSS class | `kebab-case` | `.task-title`, `.is-active` |
| Frontend unit/component test | `.test.ts(x)` suffix | `taskEditor.test.tsx` |
| Playwright test | `.spec.ts` suffix | `calendar.spec.ts` |
| Go packages | One lowercase word | `services`, `repository`, `localdate` |
| Go exported identifiers | Go naming/initialisms | `GetTask`, `HTTPServer` |
| Go test | `_test.go` suffix | `task_test.go` |
| Scripts/docs (custom) | `camelCase` base name | `testE2e.sh`, `folderStructure.md` |

**Do not rename framework/tool-required filenames:** `page.tsx`, `layout.tsx`, `apple-icon.png`, `global-error.tsx`, `instrumentation-client.ts`, `next.config.ts`, `next-env.d.ts`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `package.json`, lockfiles, `go.mod`, `go.sum`, `Dockerfile`, `Makefile`, `README.md`, `AGENTS.md` and dotfiles.

Also preserve:

- Already-applied SQL migration filenames, sequence numbers, table and column names.
- API paths, JSON field names and externally visible contracts.
- Third-party/library CSS classes, import package names and generated outputs.
- Tool-generated/build/cache directories; do not treat them as rename candidates.

On case-insensitive macOS filesystems, a case-only rename may need a **temporary intermediate name** so Git registers it. Update imports, link targets, build scripts, generated-type commands, Docker/CI and deployment paths together.

## 6. Where to put new code

| Change | Location |
|---|---|
| Task edit dialog or task-only helper | `src/features/tasks/components` / `utils` |
| Calendar event UI or drag interaction | `src/features/calendar/components` / `hooks` / `utils` |
| Timer UI and lifecycle hook | `src/features/focus/components` / `hooks` |
| Reusable dialog/toast/form primitive | `src/shared/components` |
| Account login/session behavior | `src/features/auth` |
| Cross-feature screen composition | `src/home` |
| Typed API client, generated API models | `src/shared/api` |
| New REST endpoint | `apps/api/internal/router` + `controllers` (+ DTO) |
| Validation, recurrence, planning or Focus business rule | `apps/api/internal/services` |
| SQL for account-owned entity | `apps/api/internal/repository` |
| Schema change | **New** versioned file in `apps/api/internal/database/migrations` |
| Background process orchestration | `apps/api/internal/workers` + service |
| API contract / type generation | `api/openapi.yaml` → generate to `shared/api` |
| Hosting/proxy/release logic | `deploy`, `.github/workflows` |
| Feature behavior | `docs/features` |
| Cross-cutting structure decisions | `docs/architecture` |

Frontend `src/` paths in this table are relative to `apps/web`. Prefer an existing owner; **do not create a new folder just because a layer name appears in the tree**.

## 7. Structural-change workflow

For structural changes, preserve the current ownership boundaries and verify affected frontend and backend workflows.

For structural changes, follow these safeguards without repeating unnecessary migrations:

1. **Inventory** current paths, callers, CSS, tests and baseline results; document the mapping before renaming.
2. **Refactor web structure** by ownership, then update imports, test discovery and the generated-types pipeline.
3. **Move component CSS** into local modules; verify style isolation, responsive, dark mode and FullCalendar behavior.
4. **Refactor Go by layer**, moving HTTP, domain orchestration and SQL based on responsibility, not just by filename.
5. **Update all consumers:** Makefile targets, scripts, assets, CI, Docker, Cloudflare builds, links and `go:embed` migration references.
6. **Verify** after each internal checkpoint. Separate commits inside the **same PR** are allowed for review, but do not split the planned FE/Go cleanup into multiple PRs. Run the full combined regression suite before merge.

### Verification checklist

- `make typecheck`, `make test-web` and `make build-web`; run **oxfmt `format:check`**, **oxlint `lint`** and `make check-web-architecture` as the local/CI quality gates.
- `make test-go`, `make test-integration`, `make build-api`; retain `gofmt`/`go vet`; **`make lint-go`** runs the same pinned `golangci-lint` version/config as CI, and `make check-go-architecture` enforces package boundaries.
- `make generate-api-types` does not introduce unintended OpenAPI changes.
- `make test-e2e` covers auth, tasks, calendar, Focus, analytics and settings.
- Review visual states: light/dark, mobile/responsive, overlays, focus/hover, FullCalendar drag/resize.
- Cover account isolation, conflict/revision, idempotency, schedule undo and atomic rollback in backend tests.
- Verify API/scheduler startup, migration embedding, test scripts and hosting references.
- Confirm there are no broken imports/links, newly circular packages, or accidental UI, schema or URL changes.

**Documentation tracking note:** `.gitignore` currently contains `docs/**`. Previously tracked docs remain versioned, but **new** files under `docs/` are ignored by default in a normal local `git add`. Add an explicitly intended document with `git add -f <path>` or adjust ignore exceptions in a separate reviewed change; do not indiscriminately stage old local prototypes and generated assets.

## 8. Practical rules for contributors

- Start in the **feature** on the web side; start in the correct **layer** on the Go side.
- Share mechanics, **not** feature-specific assumptions.
- Keep controllers thin, services authoritative and repositories focused on SQL.
- Keep styles near UI; don't add feature selectors to `globals.css`.
- Use current destinations rather than obsolete paths: `home` instead of `workspace`, `shared/api` instead of `src/lib/api`, `controllers` instead of `internal/server` handlers, `services` for business logic, and `repository` for SQL.
- When adding a feature, update the relevant feature doc and API contract before introducing new abstractions.
- The embedded scheduler runs only while an API process holds the shared local scheduler lock. See [production architecture](productionArchitecture.md) for Blue-Green ownership and failure boundaries.

## Related documents

- [Project README](../../README.md)
- [Feature documentation](../features/README.md)
- [Technology stack & dependencies](techStack.md) — technologies, library ownership, quality checks, and dependency policy.
- [OpenAPI contract](../../api/openapi.yaml)
- [Deployment guide](../../deploy/README.md)
- [Web tooling instructions](../../apps/web/AGENTS.md)

**Maintenance:** Update this guide when file ownership, naming rules, dependency direction or repo top-level structure changes. Keep detailed product behavior in `docs/features/`; avoid repeating every file from the live tree.
