# Integrated refactor verification

Verified locally on 2026-11-10 on `codex/integrated-refactor`, incorporating `main` at `25429eb`. This is one combined frontend and Go refactor; the maintained ownership rules are in [folder structure](folderStructure.md). No deployment or merge is part of this verification.

## Result

| Check | Result |
|---|---|
| Clean frontend install | `npm ci` succeeds; pinned Oxlint 1.91.0 and Oxfmt 0.76.0 |
| Frontend unit tests | 132 tests pass across 33 files |
| TypeScript, lint and formatting | Pass |
| Frontend architecture and quality-tool negative fixtures | Pass; intentional violations are rejected |
| API type generation | Generated output remains unchanged |
| Go formatting, architecture and negative fixture | Pass |
| golangci-lint 2.11.4 | Zero issues |
| Go vet, builds and race tests | Pass, including API and worker builds |
| PostgreSQL integration | Full suite passes against a fresh isolated test database |
| Production frontend build | Pass |
| Browser E2E | Chromium 52 pass; Firefox 49 pass / 3 skip; WebKit 49 pass / 3 skip |
| Cloudflare proxy unit tests | 7 pass |

The six browser skips are existing Chromium-only Web Push cases requiring DevTools. Browser results do not certify a live push provider or production deployment. Calendar draft, dark desktop layout and narrow dialog screenshots were also inspected without an unintended layout change.

## Scope and decisions

- Preserve the merged session-renewal baseline, including shipped `following` recurrence edits and notifications. Older plan descriptions do not request reverting these features.
- Split frontend composition, draft/save ownership, Calendar mapping/interactions, Task detail and Focus presentation. Public feature entrypoints and shared priority presentation replace private cross-feature imports; Calendar still loads lazily.
- Split Go recurrence, planning, task and Focus workflows within the existing service package. Independent comparison confirmed all 51 original declarations retain their behavior apart from formatting. API contracts, generated types, repository SQL and migrations are unchanged.
- Keep the existing controller-to-router composition edge. Services cannot depend on controllers/router, and controllers cannot depend on repositories/workers. A future relocation of server wiring can tighten the composition exception.
- Enforce Hooks and dependency rules while leaving React Compiler-specific lint rules disabled because this app does not enable that compiler. Revisit those rules if the compiler is adopted.
- Use the dedicated Compose project `todocal-integrated-refactor` on port 55439. An older local test volume had a stale notification view; the fresh volume passes without migration edits. Default ports and production deployment behavior are unchanged.
- Fix two test assumptions: Settings assertions now wait for draft hydration, and Month creation clicks an asserted empty date instead of a coordinate occupied by an event. The latter was diagnosed from the WebKit trace, retains untimed-creation assertions, and adds an exact scheduled-date assertion. The entire three-browser suite then passed.

## Review and limits

Independent Go and frontend/tooling reviews found no actionable regression. The final static review required resolving the Month browser failure before completion; the test-only correction and successful full rerun above resolve that condition. Local verification does not claim that hosted CI has run; CI status belongs to the implementation PR.

See [quality checks](qualityChecks.md) for reproducible commands and ownership rules. Review should pay particular attention to draft retry identity, Calendar DST conversion, Focus clock ownership, and Go transaction/idempotency boundaries when extending these extracted modules.
