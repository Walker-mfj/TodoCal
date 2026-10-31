# TodoCal — Technology Stack & Dependency Guidelines

> **Purpose:** Describe the technologies already used by TodoCal, what each dependency owns, and the checks required when adding or changing code.
>
> **Scope:** Frontend, Go backend, PostgreSQL, API contract, monitoring, tests, deployment and dependency governance. This is a **current-implementation reference**; future recommendations are labeled explicitly.

## 1. Architecture overview

```text
Browser / installable web app
           |
           v
Next.js + React + TypeScript (apps/web)
           |
    same-origin /api/* proxy
           |
           v
Go net/http REST API (apps/api)
           |
     pgx / SQL repository
           |
           v
       PostgreSQL
```

The current production setup uses **Cloudflare Workers/static assets** for the web app and API proxy, **Render** for the Go API and **Neon** for managed PostgreSQL. Local development uses Docker Compose for PostgreSQL. API and worker have separate Go entry points, but the free production deployment does **not** run an always-on background worker.

**Version sources of truth:**
- `apps/web/package.json` and `apps/web/package-lock.json`: frontend dependencies and pinned resolutions.
- `apps/api/go.mod` and `apps/api/go.sum`: Go module/toolchain requirements and dependencies.
- `deploy/cloudflare/package.json` and lockfile: edge deployment dependencies.
- `api/openapi.yaml`: HTTP schema; generated TypeScript types are output, not an independent contract.

Avoid duplicating exhaustive dependency-version lists in this document. Review these manifests and lockfiles when exact versions matter.

## 2. Frontend technologies

| Technology | Responsibility / existing use | Guidance |
|---|---|---|
| **Next.js (App Router)** | `src/app` routes/layout, error boundaries, provider wiring, static frontend build | Keep route entry points thin; product orchestration in `home` and `features`. Honor Next.js required file names. |
| **React + TypeScript** | Components, hooks and typed UI | Preserve a single owner of form/timer state; prefer narrow props and hooks over giant components and circular feature imports. |
| **TanStack Query** | Server-state reads, cache and invalidation | Use the existing `QueryProvider`, account-scoped query keys and `useOwnedQuery`. Invalidate affected queries after confirmed mutations; do not introduce another server-state store. |
| **FullCalendar** | Day/Week/Month views, event rendering, drag/drop and resize | Keep the adapter in `features/calendar`. Maintain server-backed scheduling/Undo, account-local wall-time behavior and locally scoped `:global(...)` CSS overrides. |
| **Luxon** | IANA timezones, local dates, deadline and event transformations | Use timezone-aware conversions for business-facing dates. Avoid fixed 24-hour assumptions around DST; the Go API remains authoritative for business validation. |
| **CSS Modules + CSS tokens** | Component-specific styles, shared colors/themes/reset | Co-locate `*.module.css` with styled components. Reserve `shared/styles` for reset/tokens/global foundations; custom class names use kebab-case. |
| **Lucide React** | UI icons | Reuse existing icons and shared controls; icons alone must not express essential status. |
| **Sentry browser SDK** | Client error capture, scrubbed before API relay | `instrumentation-client.ts` relays only sanitized errors to the API; do not send credentials, private task text, or user data to monitoring. |
| **openapi-typescript** | Generates `shared/api/apiTypes.generated.ts` from `api/openapi.yaml` | Regenerate with `make generate-api-types` when the API contract changes; **never hand-edit** generated types. |

**Data and request rules:**
- Use the existing `shared/api/apiClient.ts` and authenticated session/command/query abstractions. Do not create a second `fetch` wrapper for each feature.
- Server writes use the established **CSRF**, **Idempotency-Key**, ownership and `expectedRevision` contract. Keep exact request/key on uncertain retries.
- Authenticated cached data and drafts must remain account-isolated and cleared appropriately on logout/switch.
- Separate reusable UI **mechanisms** in `shared` from feature-specific domain behavior; see [folder ownership](folderStructure.md) and the [integrated refactoring plan](refactoringPlan.md).

## 3. Backend technologies

| Technology | Responsibility / existing use | Guidance |
|---|---|---|
| **Go + standard `net/http`** | API server, routing, request handling, business services and worker executable | Keep `controllers → services → repository` boundaries. Use existing standard-library routing/middleware before introducing another web framework. |
| **pgx/v5 (incl. pgxpool)** | PostgreSQL connections, transactions, typed query/row operations | Repositories own SQL. Use the shared `repository.DBTX` pattern and service-selected transaction; do not add an ORM for ordinary persistence. |
| **PostgreSQL** | Account-owned tasks, schedules, recurrence, focus, planning snapshots and receipts | Retain ownership predicates, uniqueness constraints, revision checks, transaction safety and indexes. |
| **golang-migrate** | Embedded versioned SQL migrations | Add new up/down migrations for schema changes; do not rewrite migrations already applied to an environment. |
| **google/uuid** | Resource identifiers | Reuse existing identifier/validation helpers; do not invent alternative ID schemes for one feature. |
| **x/crypto** | Security functions (e.g. password hashing) | Keep established password/session security; do not write custom cryptography. |
| **Sentry-compatible Go SDK** | Sanitized error events forwarded to **Better Stack** | Centralize scrubbing, quota/rate-limiting and safe logging. Do not send raw error bodies containing secrets. |

**Transaction rules:**
- `services.Execute` handles authenticated writes, idempotency receipts, and session revalidation.
- `services.WithTx` may settle historical catch-up in bounded transactions before running the final command transaction.
- `database.WithTx` serializes account operations with a settings-row `SELECT ... FOR UPDATE` lock (**not** a PostgreSQL advisory lock).
- Service code owns business invariants; repositories own SQL/scans; controllers map errors and responses. Worker jobs must reuse business services rather than bypass their transaction rules.

**Database/runtime constraint:** The free Render API process may sleep; the presence of `cmd/worker` does not imply a reliable background scheduler in production. Do not promise background Focus completion or Web Push until implemented and deployed.

## 4. API, monitoring and deployment

| Component | Source / role | Rule |
|---|---|---|
| **OpenAPI 3.1** | `api/openapi.yaml` | Source of request/response contracts. Update deliberately and regenerate TypeScript. |
| **Cloudflare Workers** | `deploy/cloudflare` | Hosts static Next.js output and forwards same-origin `/api/*` to the Go API. Avoid duplicating API auth business logic at the edge. |
| **Render** | `render.yaml` / `deploy/README.md` | Runs Go REST API; free-plan sleeping is an operational constraint. |
| **Neon PostgreSQL** | Managed production Postgres | Never use production credentials or data in tests; migrations need backups and rollout planning. |
| **Better Stack** | Error telemetry destination via Sentry-compatible payloads | Enforce sanitization, bounded errors and private source maps; diagnostics must not disclose user data. |
| **Docker Compose** | `compose.yaml` | Local PostgreSQL, distinct from isolated integration/E2E test databases. |
| **GitHub Actions** | `.github/workflows/ci.yml` and `deployFrontend.yml` | CI gates and separate frontend deployment. CI and deployment are not one atomic FE+BE rollout. |

Keep runtime secrets in provider settings or ignored local environment files. Do not add credentials, access tokens, DSNs, or private telemetry payloads to source, documentation or generated artifacts.

## 5. Formatting, lint, typecheck and tests — actual configured coverage

This table reports **configuration that exists in the repository**, not confirmation that a recent CI run passed.

| Check | Frontend | Go backend |
|---|---|---|
| **Format** | **Current:** Prettier via `npm run format:check` in CI. **Selected for refactor:** project-local **oxfmt**, retaining `format`/`format:check` script names | **Current:** `gofmt -l .` in CI; keep it and offer a local Makefile command |
| **Lint** | **Current:** no lint script configured. **Selected for refactor:** project-local **oxlint** with `lint` and `lint:fix`, React/Next.js/TS/import rules and CI gate; **do not add ESLint** | **Current:** `golangci-lint` only as a CI action. **Selected for refactor:** pinned CLI + shared config runnable locally via `make lint-go` and in CI |
| **Typecheck** | **Configured:** `npm run typecheck` → `tsc --noEmit` with strict TypeScript; CI runs it | **Configured:** Go compiler via `go build ./...` in CI; no separate TypeScript-style typecheck command |
| **Static analysis** | React/TS semantic lint is not separately configured | **Configured:** `go vet ./...` in CI |
| **Unit tests** | **Configured:** Vitest `npm test` in CI | **Configured:** `go test -race -count=1 ./...` in CI |
| **Integration** | Component/unit tests; full browser E2E separately available | **Configured:** `make test-integration` in its own CI job with PostgreSQL |
| **Browser E2E** | Playwright `make test-e2e` available locally; **not part of the main CI workflow** | Go API exercised by Playwright as part of the full end-to-end app |

**Note:** `npm run build` and `go build` are useful additional checks, but builds do not replace lint, runtime tests or database integration. The Go lint action is currently present without an explicit repository-level `.golangci.yml`; its rules/version need to be pinned and shared with local development. **Current** and **planned** status are intentionally distinguished above.

### Commands available now

```bash
# Frontend: run from repo root
(cd apps/web && npm run format:check)
make typecheck
make test-web
make build-web
make test-e2e

# Go backend: run from repo root
(cd apps/api && test -z "$(gofmt -l .)")
(cd apps/api && go vet ./...)
make test-go
make test-integration
make build-api
make build-worker
```

The **current** `format` script (`npm run format`) uses Prettier and **modifies** frontend files; `format:check` is read-only. After migration, the same scripts should use **oxfmt**. `gofmt -l` only lists files requiring formatting. Today `golangci-lint run` is **not** a documented local Makefile target; the refactor should provide `make lint-go` backed by a pinned compatible executable.

### Selected quality improvements for the single refactor (NOT YET IMPLEMENTED)

1. **FE formatter — oxfmt:** install as a pinned project dev dependency and use it for `npm run format` and `npm run format:check` (`oxfmt --check`). Migrate existing Prettier behavior/config (including print width), ignore paths and **`generate:api`**, which currently invokes `prettier --write`. Remove Prettier only when generation and all scripts work with oxfmt; review formatting diffs and keep generated types unchanged unless required.
2. **FE lint — oxlint:** install pinned, commit its configuration, add `npm run lint`/`lint:fix`, and enable appropriate React Hooks, Next.js, TypeScript and import rules. Use Oxlint's native cycle/import analysis when supported; if it cannot express TodoCal-specific feature ownership rules, supplement with a small import-boundary script. **Do not introduce ESLint as part of this plan.**
3. **Go lint — local + CI:** commit a pinned `golangci-lint` version policy, config (e.g. `.golangci.yml`) and local `make lint-go` target invoking the same rules as CI. Prefer a repo-managed pinned binary installation helper/cache over a globally floating version or a runtime `go.mod` dependency; pin the version in the GitHub Action and confirm Go toolchain support.
4. **Keep type/static checks:** preserve `tsc --noEmit`, `go vet ./...`, `go build ./...`, `gofmt`, unit/race and database integration tests. Add simple Go package-boundary checks where the linter does not enforce architecture rules.
5. **CI:** run format, lint and type/build gates for FE and Go; consider Playwright E2E in CI once browsers, database and ports are isolated. Keep local and CI commands consistent and document exact results.

These items belong to the **single FE + Go refactor implementation PR** specified in [refactoringPlan.md](refactoringPlan.md). This **documentation change does not install new packages or change CI**.

## 6. Dependency management policy

1. **Reuse what exists.** Before adding a package, check whether existing React, TanStack Query, FullCalendar, Luxon, CSS Modules, Go stdlib, pgx or other installed code already meets the requirement.
2. **Explain additions.** A new runtime dependency needs a concrete capability not served by current tools; note trade-offs, maintenance, bundle/runtime impact, security and compatibility with deployed environments.
3. **Prefer narrow dependencies.** Avoid adding a full framework or state manager to replace one small helper.
4. **Update manifests and lockfiles together.** Use `npm install` / `npm ci`-compatible changes or `go get` and `go mod tidy` with reproducible builds; don't edit lockfiles by hand.
5. **Review upgrades.** Check release notes and breaking changes against the current Next.js/Go toolchain; run typecheck, lint, builds, focused tests and integration/E2E where applicable.
6. **Keep infrastructure contracts safe.** An upgrade must not accidentally change session/cookie, timezone, history, recurrence, idempotency, or Cloudflare/Render runtime behavior.
7. **Record real architectural decisions.** For significant replacements, document the reason and migration/rollback plan rather than introducing competing libraries.

## 7. Anti-patterns and ownership guardrails

- No second calendar engine or date-time library for a feature already served by FullCalendar/Luxon.
- No frontend global state library solely to duplicate account-owned TanStack Query data.
- No new styling framework solely to replace existing CSS Modules in one component.
- No ORM or alternate HTTP framework solely to simplify one Go handler/repository query.
- No imported private feature implementation in `shared`, and no duplicated Focus/calendar/business rules across FE and Go.
- No feature-specific SQL inside Go controllers and no manual edits to generated TypeScript API definitions.
- No assumption that passing format/typecheck means lint, E2E, or production behavior is verified.

## 8. Related files

- [Folder structure](folderStructure.md) — module ownership, naming and dependencies.
- [Unified refactoring plan](refactoringPlan.md) — FE + Go refactor and proposed architecture checks.
- [Web package manifest](../../apps/web/package.json) — frontend dependency definitions and scripts.
- [Go module](../../apps/api/go.mod) — backend dependencies and toolchain.
- [CI workflow](../../.github/workflows/ci.yml) — currently configured checks.
- [Frontend deployment workflow](../../.github/workflows/deployFrontend.yml) — production web deployment gates.
- [OpenAPI contract](../../api/openapi.yaml) — generated type source.
- [Deployment guide](../../deploy/README.md) — environment limitations and release order.
- [Root README](../../README.md) — local development commands.

**Maintenance:** Update this guide when technology ownership or quality tooling changes. Keep exact dependency versions in package manifests/lockfiles, and update the coverage matrix only after the corresponding CI/scripts exist.
