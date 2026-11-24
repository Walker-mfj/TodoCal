# Architecture and quality checks

The product contracts are in [docs/features](../features/README.md). A structural change preserves the currently shipped workflows, including recurring edits from a selected occurrence onward, scheduled notifications and session renewal.

## Where changes belong

- **Web:** `app` wires routes/providers, `home` composes features, and `shared` contains domain-independent mechanisms and reused presentation. Features may use another feature's public `index.ts`; they cannot import its private components, hooks, types or styles. The same rule applies to colocated tests. Tests that mount the whole provider tree belong with the app composition. The calendar owns its slot/preview inputs; the task editor owns drafts and the exact payload/key of an uncertain save. Focus owns the server clock anchor shared by its displays.
- **Go:** HTTP controllers call services; services run account-owned workflows in repository-backed transactions. Recurrence creation, materialization, edits and stop/restore live in separate files in the same service package. Planning reports, settlements and snapshots share the original transaction machinery. Moving a function must preserve account locking, bounded catch-up, revision checks, journal writes and idempotent command receipts.
- **Generated code:** edit `api/openapi.yaml`, then run `make generate-api-types`. Commit the generated TypeScript only when the contract changes.

## Local and CI checks

| Check | Command from the repository root |
|---|---|
| Install exact frontend dependencies | `cd apps/web && npm ci` |
| Frontend formatting and lint | `cd apps/web && npm run format:check && npm run lint` |
| Frontend and Go import boundaries, including negative fixtures | `make check-web-architecture check-go-architecture` |
| TypeScript, unit tests and production build | `make typecheck test-web build-web` |
| Go formatting and lint | `make format-go-check lint-go` |
| Go analysis, builds and race tests | `(cd apps/api && go vet ./... && go build ./...)`, then `make test-go build-api` |
| Database integration | `make test-integration` |
| Browser workflows and layout checks | `make test-e2e` (Chrome, Firefox and WebKit) |

Run `npm run format` or `npm run lint:fix` in `apps/web` to apply local fixes. CI runs read-only checks. Oxfmt and Oxlint versions come from the npm manifest and lockfile. Oxlint checks hooks, Next.js, TypeScript and module cycles. React Compiler-specific purity/immutability, render-time ref and effect-state rules are outside this migration; the app does not enable React Compiler. Hook ordering and effect dependencies are enforced. The additional TypeScript import check resolves path aliases and feature boundaries, including cycles between features whose individual modules are acyclic.

The Go linter uses the checked-in configuration in `apps/api/.golangci.yml`. The local installer and CI both read `scripts/tools/golangci-lint.version`. On macOS/Linux, the first local run downloads the release binary for the current platform, verifies its published checksum, and caches it under `.local/tools`. No runtime Go dependency is added.

The integration and browser scripts use only the project's dedicated test databases. To run them on a separate volume while another checkout has its database open, supply a unique Compose project and free local port, for example:

```sh
COMPOSE_PROJECT_NAME=todocal-refactor POSTGRES_HOST_PORT=55439 make test-integration
COMPOSE_PROJECT_NAME=todocal-refactor POSTGRES_HOST_PORT=55439 make test-e2e
```

The default database port remains 55432. Browser suites still share local web/API ports 3002/18080; run them sequentially. These commands never need a production database URL.

## UI color and loading rules

These rules are mandatory for new or changed web code and AI-generated changes. Existing violations are tracked in the [global colors and loading skeletons plan](globalColorsLoadingPlan.md); do not introduce new violations while migrating them. `npm run lint` runs `check:ui` and its regression fixtures. The check currently covers fixed literals and direct loading JSX; computed/imported placeholder strings and unusual CSS syntax still require review. UI003/UI004 below are proposed extensions; add mechanical checks where practical in the next implementation pass.

### UI001 — Global color ownership

- Define application-owned fixed colors only in `apps/web/src/shared/styles/tokens.css` (semantic CSS tokens, with appropriate light/dark overrides) or the designated shared concrete color registry for values that cannot use CSS variables (manifest, serialized palette, incompatible library APIs).
- Reuse semantic tokens before adding new ones. Consume tokens via `var(--color-…)`, existing priority tokens, `currentColor`, or derived expressions. No raw fixed hex, rgb/rgba, hsl, oklch or named color literals in component CSS, JSX style props, SVG fill/stroke, JS options, gradients, shadows or local custom properties. Do not duplicate registry values in CSS; use one source of truth.
- Allowed: transparent/inherit/currentColor, non-color strings, arbitrary validated user/API color data, test fixtures deliberately representing that data, generated files and documented standalone branding assets. Do not change hex persistence or wire validation just to satisfy this rule. Document any other exception with its file, reason and narrow scope.

### UI002 — Shared skeleton placeholders

- For initial content loading, lazy component imports, Suspense fallbacks and inline values awaiting data, use the shared `Skeleton` at `apps/web/src/shared/components/skeleton/skeleton.tsx`, not visible placeholder text (e.g. Loading…, Opening your workspace…). Compose rectangle/circle instances with appropriate dimensions in the owning layout. Do not define feature-local skeleton primitives, shimmer styles or animations.
- Keep the shell and dimensions stable; placeholders are decorative, aria-hidden and noninteractive. Mark the actual content region aria-busy and provide one accessible status as appropriate. Respect reduced motion.
- Keep loaded content visible during background refetch where safe. Distinguish initial loading from empty, error, offline, disabled and uncertain states; preserve deletion-preview confirmation guards.
- Action-pending and settlement text, pending toasts, error/retry labels and accessible status strings are not content placeholders. Do not use Skeleton for these states; follow UI003 for active operations.
- Review initial, cached refetch, empty and failed states, plus regression checks for existing pending actions. Use existing test/lint commands above. Search changed files for raw colors and loading placeholders; classify matches rather than blindly replacing legitimate data or status text.

### UI003 — Shared action loading indicator

- Use the shared `LoadingIndicator` at `apps/web/src/shared/components/loadingIndicator/loadingIndicator.tsx` once implemented for active mutations, requests initiated by an action, pending toasts and authoritative settlement feedback. Do not create feature-local spinners or animation.
- Preserve existing pending labels, disabled/retry/error/uncertain/offline behavior and timer digits. Show an indicator only for the actual active operation, not every disabled control or a command waiting for manual retry. Track initiating action identity if necessary. Do not use Skeleton or full-page loading for an action.
- Use semantic global colors or currentColor; keep geometry stable, respect reduced motion, and use one accessible status. Decorative indicators accompanying text are aria-hidden.
- Extend the source check for direct, recognizable pending branches and duplicate spinner implementations where practical; review operation identity and indirect branches manually. Existing pending labels are allowed when accompanied by the shared indicator; retry/error text does not require one.

### UI004 — Shared full-page loading

- Reuse `LoadingPage` at `apps/web/src/shared/components/loadingPage/loadingPage.tsx` once implemented for genuine full-page/app bootstrap loading, including session restoration. Compose the shared LoadingIndicator rather than creating a page-specific spinner; use global tokens and one accessible busy/status region.
- Keep loaded workspace content visible during local navigation, data refetch and mutations. Use local Skeletons for missing content and LoadingIndicator for active actions. No global loading overlay or unnecessary route boundaries.
- A Next App Router loading.tsx is only justified if an actual asynchronous route transition needs a fallback. If introduced, reuse LoadingPage. Verify resolved sign-in, signed-out, expired, offline and error states; do not flash another account's content. Check page fallback ownership in review.
