<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## TodoCal UI rules

Before changing presentation or loading states, read [UI001–UI004 in the architecture and quality checks](../../docs/architecture/qualityChecks.md#ui-color-and-loading-rules). These are mandatory for AI-generated and human-authored changes.

- UI001: use global semantic color tokens or the shared concrete color registry; no fixed color literals in component styles, JSX or library options. Preserve user-provided group colors and documented exceptions.
- UI002: use the single shared `Skeleton` primitive for initial content-loading placeholders, including lazy imports, Suspense and inline values. Compose rectangle/circle instances; do not create feature-local skeleton styles or animation. Action-pending and focus settlement use UI003 rather than Skeleton. Keep layout stable, accessible, and retain cached content during refetch where safe.
- UI003: use the shared `LoadingIndicator` for actual in-flight actions, pending toasts and focus settlement. Preserve existing operation labels, retry/error/uncertain/offline semantics; never spin unrelated disabled controls.
- UI004: use shared `LoadingPage` for genuine full-page/bootstrap loading. Reuse LoadingIndicator; keep local data loading and mutations within the workspace shell. Do not add unnecessary Next route loading boundaries.
- Do not add new violations while the existing migration is pending. See the [implementation plan and inventory](../../docs/architecture/globalColorsLoadingPlan.md). Follow existing format, lint, architecture and test commands; review changes for these rules even before automated checks are implemented.
