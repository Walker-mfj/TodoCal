# Global colors and loading skeletons — implementation plan

Status: color/loading implementation completed on top of PR #57, including the action indicator and initial session-restoration page. UI005 asset ownership follow-up below is planned; its code migration and automated check are not yet implemented.

Validation: 44 frontend test files / 176 tests, typecheck, lint (UI001–UI004 fixtures), and architecture checks pass. Browser E2E remains unverified: Docker is unavailable, and the installed Chromium cannot launch because this environment denies its socket operation. The source checker handles direct syntax; imported/computed strings and indirect request ownership still require review.

## Review fixes and operation audit

- Calendar now receives actual fetch state (`isFetching && !error`), renders visible noninteractive placeholders only for missing days while fetching, and retains loaded day content. Missing/failed resolved data has no perpetual skeleton.
- Semantic color roles replace numbered aliases. Theme overrides for danger text, toast error text, and sidebar accents live in tokens.css; focus-scene values remain independent of workspace mode.
- `lint:fix` invokes Oxlint with `--fix` directly. UI lint recognizes bare Loading, Fetching, logical expressions, exact hidden-class tokens, named CSS colors and gradient stops. UI003/UI004 check direct pending text and route fallbacks.
- Shared LoadingRegion provides the busy visual subtree and one accessible status outside that subtree. Visually hidden styling is shared; Skeleton remains decorative.
- All nine labelled operations use LoadingIndicator: auth submit, recurrence scope, both focus settlement displays, device enable, settings save, recovery Undo, task editor submit, and scheduling toast. Recurrence scope tracks the chosen action.
- Additional visible ownership is tracked for group save/delete, task-row/detail completion, task deletion and completion time, notification revoke/retry, and focus start/pause/resume/end/retry/refresh/permission. `usePendingAction` tracks only returned promises and clears after settlement; synchronous callbacks do not manufacture pending work.
- Shared disabled flags, synchronous navigation/draft updates, and actions without an observable local promise remain exceptions: no unrelated spinners are inferred. General workspace/background refresh keeps existing content and does not activate LoadingPage. Existing focus timing, command retry identity and uncertain-state semantics are preserved.
- LoadingPage replaces only initial AuthScreen session restoration. It composes LoadingIndicator, responsive shared theme styles, a busy subtree and one status. No route loading boundary was added.
- Focus settlement indicators run only while the reconciliation request is actually fetching; a failed request leaves the existing confirmation text/digits and manual retry, without an indefinite spinner.
- LoadingIndicator uses currentColor and one shared animation; reduced motion disables rotation. Browser sizing/visual checks remain pending.

## Goals and boundaries

- All application-owned fixed UI colors live in the global color system. Components must consume semantic tokens rather than literals.
- Replace visible text-only content-loading placeholders with layout-shaped skeletons using one shared Skeleton component. Use a separate shared LoadingIndicator for active operations and authoritative settlement, preserving existing labels and behavior. Use a shared LoadingPage composition only when the entire app/page is genuinely unavailable.
- Preserve current light/dark appearance, user-selected group colors, existing query/command behavior, focus timing, accessibility, and deployment contracts. Do not introduce new lazy imports or network delays merely to display a skeleton.

## Audit baseline

Reviewed main at `b25edc0cf895f22e4d2c8ab9fdb5428388719eb0`. Repository tree was enumerated (not truncated). Read all 41 CSS files, all 50 non-test TSX files and all non-test/non-generated TS files under `apps/web/src`; searched CSS literal colors and JSX/TS loading-state keywords, conditional labels, fallback and ellipsis patterns. Also checked the service worker, Next config, Cloudflare worker/build/deployment/maintenance entry points, backend group validation/model, and selected related tests. The inventory below covers the audited first-party web runtime; it is not an exhaustive scan of every Go file, test, lockfile or deployment script. Re-run a full tracked-file audit in the implementation PR and classify remaining matches, including non-web paths. Line numbers refer to the baseline; use the file names and symbols if lines move.

## 1. Global color system

`apps/web/src/shared/styles/tokens.css` already owns theme colors with `:root` and `[data-mode="dark"]`. `app/layout.tsx:3` imports it globally. Extend this file rather than creating a competing theme file. Preserve the current values first; color redesign is separate.

- Reuse existing tokens when the semantic role and theme behavior match. Introduce semantic tokens for danger, invalid form, calendar current-time line, event preview, shadows, skeleton, focus scene and sidebar gradient roles. Do not conflate visually similar but semantically different values.
- The focus scene is intentionally dark-looking independently of workspace mode: use explicit focus-scene tokens with the current values in both modes. Preserve alpha, gradient stops, shadow opacity and hover/focus states.
- Normalize new names under `--color-*` (or the existing priority family); use `var(--color-…)` in CSS Modules, inline styles and supported SVG/library style inputs. Existing global priority hex values are already compliant. `currentColor`, `transparent`, `inherit` and derived values such as `color-mix(... var(--color-*) ...)` are allowed.
- Values that must be concrete hex strings outside the CSS cascade (manifest, group palette/default, a library that cannot resolve variables) belong to one documented shared color-value registry, e.g. `src/shared/constants/colorValues.ts`. If the same value is needed in CSS and TS, derive/generate the CSS declaration from that registry or provide a verified single-source bridge; do not maintain two literal copies. Theme-sensitive CSS remains in tokens.css. Do not resolve CSS variables at module evaluation or rely on DOM APIs during SSR.
- Group colors are data: the UI palette and its default must use shared concrete hex constants (default references Blue). Retain arbitrary valid user colors from API/DB and the six-digit wire format, native color input and draft serialization. Do not replace persisted group values with CSS variables, rewrite history/snapshots or modify migrations/API contracts. Confirm FullCalendar renders CSS variables correctly in the event DOM; otherwise resolve the shared token via a client-safe adapter or use a centralized concrete fallback. Manifest is static and must receive a literal value via import, not CSS var.

### CSS inventory

Paths relative to `apps/web/src/`. Every listed line contains a raw hex literal; multiple values on a line are included. All 13 non-token CSS files with hits are below.

| File | Lines and values | Migration |
| --- | --- | --- |
| features/auth/components/accountMenu/accountMenu.module.css | 40 `#0003` | menu shadow |
| features/calendar/components/calendar/calendar.module.css | 224, 238 `#e3342f` | current-time accent |
| features/calendar/components/eventContent/eventContent.module.css | 130 `#b65145`; 302–303 `#fffaf3`, `#d8cbbb`; 306 `#0002`; 310 `#40352d` | event accent, preview surface/border/shadow/text |
| features/focus/components/floatingFocus/floatingFocus.module.css | 11 `#0003`; 38, 44 `#0004` | floating shadow/elevation |
| features/focus/components/timerPanel/timerClock.module.css | 19 `#ffffff16`; 23 `#a8caff`; 31 `#f3f7f8`; 34 `#b5c6d0` | focus track, ring, digits, muted |
| features/focus/components/timerPanel/timerPanel.module.css | 64 `#edf3f5`; 66–68 `#38606b88`, `#314c6555`, `#172d38`, `#101c2b`, `#192e3c`; 81 `#0a172380`; 83–84 `#52717b0a`, `#52717b08`; 91, 108, 138 `#ffffff12`; 98, 124, 156, 186, 191, 198 `#b5c6d0`; 103 `#ffffff30`; 104 `#d5e2e7`; 111 `#b0ceff`; 137 `#0c192680`; 147 `#d6e5ff`; 148, 178 `#17365f`; 161 `#122737`; 162 `#e9f1f4`; 163 `#48616f`; 177, 179 `#c5dbff`; 183 `#e0ebff` | focus scene gradient, decoration, surface, border, labels, controls and focus outline |
| features/focus/components/timerPanel/timerTaskPicker.module.css | 3, 14 `#b5c6d0`; 8–10 `#122737`, `#e9f1f4`, `#48616f` | reuse focus scene select/label tokens |
| home/components/workspaceLayout/workspaceLayout.module.css | 112 `#0002` | workspace elevation |
| home/components/workspaceSidebar/workspaceSidebar.module.css | 455 `#0861ce`; 456 `#087b91`, `#1456d9`; 462 `#70c4ff`; 463 `#61e4d3`, `#7eb5ff` | sidebar gradient/text, light and dark |
| shared/components/dialog/dialog.module.css | 11 `#0003`; 67–69 `#b42332`, `#b42332`, `#fff`; 72–74 and 77–79 `#8f1827`, `#8f1827`, `#fff` | dialog elevation and destructive normal/interactive states |
| shared/components/toast/toast.module.css | 21 `#0002`; 37 `#b42332`; 40 `#ffb5b5` | toast shadow and danger text in both modes |
| shared/styles/formControls.module.css | 122–123 `#c74949` | invalid control border/outline |
| shared/styles/uiPrimitives.module.css | 38 `#b34545`; 41 `#f0a0a0`; 58, 60 `#ba4747` in color-mix; 162, 164 `#b42332` | danger text, soft background and border |

Already centralized: `shared/styles/tokens.css:74–87` contains 12 priority hex declarations. Keep them in the global system. All other raw color syntaxes (rgb, rgba, hsl, oklch, named fixed colors, gradient stops and alpha variants) follow the same policy; the initial audit specifically targets hex and common CSS color functions.

### TS/TSX inventory

| File | Lines and values | Migration |
| --- | --- | --- |
| app/manifest.ts | 14–15 `#f7f8fa` twice | import shared PWA chrome value |
| features/calendar/components/eventContent/eventContent.tsx | 137 `#fff` in --clock-hand | semantic event clock contrast token |
| features/calendar/utils/calendarEvents.ts | 40–43 `#7391ba` | calendar ungrouped event border fallback |
| features/tasks/components/groups/groups.tsx | 15–22 `#4169b1`, `#ed7d31`, `#278765`, `#8056b3`, `#c84e75`, `#16838c`, `#b58a23`, `#64748b`; 44 `#4169b1` | shared group palette and default reference |
| home/components/dayDetailPanel/dayDetailPanel.tsx | 83 `#999` | ungrouped history marker token; preserve actual groupColor |

Non-UI exceptions: `apps/api/internal/services/groupCommands.go:21,28–29` validates six-digit hex, and `apps/api/internal/models/group.go:5` stores color as a string. Retain these. Example test-data exception: `features/tasks/components/taskDetail/historyDetail.test.tsx:37` uses `#123456` as historical group data. Do not alter fixtures that deliberately assert arbitrary persisted values. Intrinsic branding/illustration colors are allowed in documented assets; theme-aware UI icons and dynamic SVG use tokens/currentColor or a static SVG mask with token-driven visible color. Opaque stencil paint inside a mask is not a UI palette color. See UI005 below. Audit any production HTML/CSS embedded in deployment scripts too; if it cannot import the application CSS, generate or import the standalone shared value rather than duplicating literals.

## 2. Loading placeholders

Implement one shared, domain-independent `Skeleton` component in `src/shared/components/skeleton/skeleton.tsx`, with colocated `skeleton.module.css` and `skeleton.test.tsx`. All initial content-loading placeholders, including Next dynamic imports, Suspense fallbacks and inline values awaiting data, must reuse it. This is a visual primitive, not a query or mutation wrapper.

### Shared Skeleton contract

Keep the API small:

- `width` and `height`: accept CSS lengths or numbers (pixels); use sensible shared defaults.
- `variant`: `rect` (default, rounded rectangle) or `circle`. Text bars are simply rectangles with appropriate dimensions.
- The primitive is decorative and aria-hidden. The owning loading region supplies aria-busy and one concise accessible status as appropriate.
- All color, radius defaults and optional animation live in shared styles using global tokens. Respect prefers-reduced-motion. Use markup that works for both inline values and larger blocks, with no focusable elements.

Usage:

```tsx
<Skeleton width="100%" height={16} />
<Skeleton width={48} height={48} variant="circle" />
```

Compose instances within the feature's existing layout to approximate rows, cards, calendar cells, progress rings or grids. Feature code owns layout and sizing, not skeleton visuals or animation. No separate rows, grid, text or indicator variants; no feature-local skeleton primitives, new loading framework or dependency.

- Reserve dimensions and avoid layout/scroll shifts. Do not show fake interactive controls. Use the same primitive for lazy module fallbacks and initial data loading.
- Keep already loaded content visible during background refetch where safe. Keep deletion-preview actions blocked while the authoritative preview is being checked, even if a previous preview remains visible.
- Only use skeletons where content is genuinely unavailable and expected to arrive. Distinguish initial loading from resolved empty, error, disabled, offline and uncertain states; do not leave a skeleton indefinitely for absent or disabled queries.
- Preserve existing mutation pending labels, toast feedback, disabled controls, retries, focus digits and authoritative settlement states. Add the separate shared LoadingIndicator described below; a Skeleton is not an action-pending indicator.
- Keep accessible loading announcements even when visible placeholder text is removed. Preserve feature import boundaries.

### Initial content / module loading inventory

Paths relative to `apps/web/src/`.

| File | Line(s) / current visible text | Proposed skeleton |
| --- | --- | --- |
| features/auth/components/authScreen/authScreen.tsx | 20–24 Opening your workspace… | session-restore shell/card; don't flash sign-in form |
| features/calendar/components/calendar/lazyCalendar.tsx | 7 Loading calendar… | calendar shell/grid matching desktop/mobile dimensions |
| features/calendar/components/calendar/calendar.tsx | 97–110 Loading | in-cell progress chip placeholder; keep noninteractive |
| features/calendar/components/progress/progress.tsx | 21–25 Loading today’s progress… | progress ring + title/metric bars |
| features/focus/components/timerPanel/timerTaskPicker.tsx | 27, 49 Loading tasks… | selector-sized placeholder; preserve disabled control and retry |
| features/notifications/components/notificationSettings.tsx | 139–140 Checking this device… | device status card with label and action-sized blocks |
| features/settings/components/settingsForm/settingsForm.tsx | 83 Loading settings… | settings field groups and action row |
| features/tasks/components/taskDetail/taskDetail.tsx | 86–92 Loading… (historical group); 174–178 Loading… (actual focus time) | inline group/value bars inside existing detail rows; separate error branch |
| features/tasks/components/taskDetail/taskDetail.tsx | 303–305 Checking affected occurrences… | deletion preview summary block; preserve confirmation guard |
| features/tasks/components/taskDetail/taskDetailSections.tsx | 27–28 Loading repeat details…; 81–82 Loading sessions… | recurrence rows and focus history list |
| home/components/dayDetailPanel/dayDetailPanel.tsx | 38–39 Loading day… | day summary and task/event rows |
| home/components/progressPanel/progressPanel.tsx | 106–107 Loading progress… | analytics metric/card and chart-shaped placeholders |
| home/components/taskListPanel/taskListPanel.tsx | 60–61 Loading tasks… | list rows with status/avatar/title/action geometry |

15 transient content-loading sites in 12 distinct files (13 table entries, two refer to taskDetail.tsx); some entries contain more than one state. Preserve accessible labels even when no loading text is visible.

### Shared LoadingIndicator — implemented extension

Implement one reusable `LoadingIndicator` in `src/shared/components/loadingIndicator/` (component, CSS Module, unit tests). Keep it separate from Skeleton: the spinner indicates active work, not missing content. Do not introduce a dependency, a global request counter, or a feature-local spinner.

- Minimal API: `size?: number` (pixels, default 16), optional accessible `label` for standalone use. Use currentColor or a global semantic token and shared animation; use a static recognizable glyph under prefers-reduced-motion. No hardcoded colors.
- A decorative indicator is aria-hidden when accompanied by visible text or an existing status region. Standalone indicator requires an accessible status. Never create nested live regions or change the accessible name of an icon-only action unintentionally.
- Keep action-specific pending text (Saving…, Restoring…, etc.) beside the indicator where it already exists. Reserve icon/label space so the button or toast does not jump; preserve existing disabled logic, focus, error, retry, uncertain-command and offline behavior. The indicator never starts a request or controls the button.
- Show it only for the actual in-flight action, not merely because a control is disabled or an uncertain command awaits retry. If a shared command busy flag locks multiple unrelated controls, track the initiating action locally or reuse existing action identity; do not show spinners on every disabled button. For timer settlement, show it only under the existing online, unpaused, zero-remaining confirmation condition and preserve timer digits.
- Stop on success, error, cancellation, offline transition as appropriate, or uncertain state; do not spin indefinitely while waiting for manual retry. Background fetches with usable cached content must not trigger page loading or unrelated button indicators.

Usage:

```tsx
<button disabled={busy} aria-busy={busy || undefined}>
  {busy && <LoadingIndicator />}
  {busy ? "Saving…" : "Save changes"}
</button>
```

### Action/settlement pending inventory

Confirmed against PR #58 head `e2e643ce08f111a35e96feb26d910b8b367b45d4`; paths relative to `apps/web/src/`. Preserve the labels listed here and add the shared indicator beside them.

| File | Current head line / status | Placement |
| --- | --- | --- |
| features/auth/components/authScreen/authScreen.tsx | 149 Please wait… | active sign-in/register submit |
| features/calendar/components/scheduleScopeDialog/scheduleScopeDialog.tsx | 43 Saving… | actual submitting scope action, not both buttons |
| features/focus/components/timerBar/timerBar.tsx | 39 Confirming completion… | inline timer status |
| features/focus/components/timerPanel/timerClock.tsx | 41 Confirming completion… | inline clock status |
| features/notifications/components/notificationSettings.tsx | 189 Enabling… | device enable action |
| features/settings/components/settingsForm/settingsForm.tsx | 479 Saving… | active settings save |
| features/tasks/components/recoveryToast/recoveryToast.tsx | 51 Restoring… | Undo/restore action |
| features/tasks/components/taskEditor/taskEditor.tsx | 289 Saving… | create/edit submit |
| home/components/homePage/homePage.tsx | 314 Saving calendar change… | existing pending toast; retain indefinite duration while busy |

Also audit pending operations that currently expose only a disabled control: group create/edit/delete (groups.tsx:64–192), task completion/deletion (taskDetail.tsx:120–330, completionTimeForm.tsx:51–57, taskRow.tsx:66), calendar undo and recurrence scope selection, focus start/pause/resume/end (timerBar.tsx:43–51, timerPanel.tsx:181–211), notification revoke/test actions (notificationSettings.tsx:79–88,334–347), settings recovery and workspace retry actions. Inspect actual command/handler ownership first: add the indicator only to the initiating visible control or its existing status region if an active operation is observable. Do not invent pending state for synchronous actions; shared disabled flags alone are not evidence that a particular action is running. Record final file/line inventory and any exceptions in the implementation PR.

### Full-page loading — implemented extension

Current route audit at the same head: `src/app/page.tsx:1–3` renders HomePage; `src/app/layout.tsx` wraps providers; `homePage.tsx:65–66` returns AuthScreen during session restoration or when signed out; `authScreen.tsx:21–45` currently renders two skeleton bars while restoring the session. There is no tracked Next App Router `loading.tsx`, other page route, or dedicated LoadingPage component. Calendar's dynamic fallback is local to the Calendar, not a full-page loading state.

- Implement a shared presentational `LoadingPage` in `src/shared/components/loadingPage/` (component, CSS Module, tests) as a centered, responsive viewport-sized shell composing the shared LoadingIndicator and one concise accessible status, optionally a shared Skeleton composition if the future page layout is actually known. Minimal optional `label` (e.g. Opening your workspace…). Reuse existing global background/text/spacing tokens, not feature imports or fixed colors; no duplicate spinner or animation.
- Replace only the current initial session-restoration fallback with LoadingPage at the HomePage composition boundary (or the existing AuthScreen loading branch, with exactly one owner). Do not flash sign-in, workspace or stale account data. The unauthenticated branch must still show the login/register screen after restoration resolves; session error/expiry/offline outcomes must remain explicit. Do not use LoadingPage during routine session renewal or background refetch.
- Add an App Router `loading.tsx` or other route-level Suspense fallback only if a real asynchronous route transition exists that needs it; currently no such boundary is necessary. Any future full-page fallback should reuse LoadingPage. Keep the workspace shell visible for local navigation, Calendar chunk loading, settings/data fetching and mutations; continue to use local Skeletons or LoadingIndicator there.
- Page loading must not be a global overlay for every network request, block already usable content, cause double announcements, or conceal error/empty states. Use an actual busy region and one status; ensure mobile viewport sizing, light/dark rendering and reduced-motion behavior.

Other matches are not loading UI: nonvisual state variables, disabled conditions, search/description input placeholders, daylight-saving wording, error/retry messages, offline estimates and uncertain save guidance. Preserve these behaviors and texts.

## 3. Implementation sequence

1. **Color foundation:** document semantic names and concrete-value bridge. Add tokens/registry, preserve current light/dark values and focus scene. Migrate CSS Modules, then TS/TSX and manifest. Verify arbitrary group colors and calendar rendering.
2. **Skeleton primitive:** implement the single shared rectangle/circle Skeleton and accessible region convention; add unit tests. No new dependency.
3. **Feature migration:** session and calendar first, workspace lists/progress, settings/notifications, task detail and deletion preview. Review loading versus empty/error branches individually. Retain local skeletons; migrate full-page bootstrap separately.
4. **Loading indicator and page:** implement the two small shared components, migrate the confirmed pending sites and the session-restoration page; audit disabled-only actions for actual in-flight ownership. Preserve all operation labels and semantics.
5. **Enforcement:** implement a small deterministic source check in web scripts (or equivalent compatible tooling) following the existing Oxfmt/Oxlint plus architecture-check pattern. Wire into `npm run lint` or a dedicated check invoked by both local Make targets and CI. Add positive/negative fixtures. The documentation rules apply to new/changed code now; mechanical enforcement starts in the implementation PR after baseline violations are removed.
6. **Verification:** run tests and a fresh tracked-file audit. Remove temporary migration allowlists. Keep only explicit, narrowly scoped exceptions.

## 4. Lint and review strategy

See [Architecture and quality checks](qualityChecks.md#ui-color-and-loading-rules) and `apps/web/AGENTS.md` for normative rules. Suggested initial audit (from repo root, use git grep to ignore untracked build output):

```sh
git grep -nEi '#([[:xdigit:]]{8}|[[:xdigit:]]{6}|[[:xdigit:]]{4}|[[:xdigit:]]{3})([^[:xdigit:]]|$)' -- apps/web/src apps/web/public deploy apps/api api
git grep -nEi 'loading|please wait|opening your workspace|checking|saving|restoring|enabling|confirming completion|isPending|isFetching|fallback|suspense' -- apps/web/src
git grep -nE '…|\.\.\.' -- apps/web/src
```

These are discovery commands, not sufficient lint rules. Classify results rather than blindly replacing identifiers, anchor fragments, arbitrary group data, test strings, retry labels, logs, checksums or API validators. The full implementation audit should also search every tracked source extension and inspect loading fallbacks that use no obvious keyword.

- Color rule: detect exact 3/4/6/8-digit CSS hex tokens and other fixed color expressions in CSS declaration values, inline styles, CSS strings/template literals, SVG presentation attributes, manifest and library options. Prefer CSS parsing/tokenization and TypeScript AST over blanket regex; distinguish CSS IDs, URLs and unrelated strings. Allow only designated global declarations/registry, generated outputs and explicitly documented non-UI data/standalone asset exceptions. Reject local custom properties that hide raw colors.
- Placeholder rule: flag visible text-only content-loading JSX and dynamic/Suspense text fallbacks in recognized branches, including imported string constants where practical. Require shared Skeleton usage/composition with accessible status. Flag duplicate feature-local skeleton animation/placeholder implementations in review; add lint coverage for known bypass patterns. A conservative automated heuristic plus mandatory review is preferable to claiming all React control flow is statically decidable. Allow operation labels, settlement text and pending toast text alongside LoadingIndicator. Enforce shared indicator use for direct, recognizable in-flight UI branches (UI003); use review for indirect command identity and page boundaries. Do not flag error/retry labels, uncertain/offline states, hidden accessible statuses or nonvisual logic. Flag feature-local spinner/animation duplication; require full-page fallback to reuse LoadingPage (UI004), with route placement enforced by review where static checks cannot infer it.
- Emit actionable file:line diagnostics, rule ID and suggested replacement. Negative tests include CSS gradients/shadows, 4/8-digit alpha, inline SVG/JS colors, local variables and visible content-loading placeholder text; positive tests include tokens, currentColor, transparent, derived colors, group input data, manifest registry, shared Skeleton, LoadingIndicator with operation text, LoadingPage, uncertain/retry labels without a spinner, and screen-reader status. No broad per-directory production bypass.

## 5. Acceptance and regression checks

- Zero application-owned fixed UI color literals outside approved global declarations/registry or reviewed exceptions; no duplicate palette/default or manifest value. Light/dark and focus scene visual regression checked (calendar now line, event hover/preview, dialog danger hover, toast, invalid forms, sidebar and timer).
- All 15 listed content-loading sites use shape-matched shared Skeleton instances. No duplicate skeleton primitive or feature-local skeleton/shimmer styles. No visible text-only content-loading placeholder. All nine confirmed action/settlement pending sites use LoadingIndicator while keeping existing labels and behavior; audit additional disabled-only operations, with no indicator on unrelated disabled controls. No skeleton after resolved empty/error/disabled states. Background refetch retains data. Skeletons are noninteractive and reduced-motion safe.
- Initial session restoration uses LoadingPage; no full-page loading for background refresh, local navigation, lazy Calendar or mutations. No redundant Next loading.tsx unless justified by a real route boundary.
- Test shared indicator sizing, accessibility, reduced motion and stopped states; verify only initiating actions show an indicator, including both success and failure/uncertain/retry paths. Test LoadingPage for delayed session restore, signed-out, expired/offline/error and signed-in outcomes without flashing the wrong screen.
- Test delayed initial requests, lazy module loading, slow/rejected mutations, retries, background refetch, disabled queries, navigation, account switching, offline focus and server completion confirmation. Verify deletion-preview confirmation stays blocked while fetching and recovery toast Undo behavior survives.
- Verify screen-reader busy/status, keyboard focus/tab order, unchanged action-pending labels and no layout shifts in desktop/mobile. Update assertions that currently rely on visible loading strings; prefer semantic status/region or specific skeleton test IDs with delayed responses.
- Extend existing tests in `app/providers.test.tsx`, `features/tasks/components/taskDetail/{historyDetail,taskDetail}.test.tsx`, `features/focus/components/timerPanel/timerTaskSelection.test.tsx`, `features/notifications/components/notificationSettings.test.tsx`, `features/settings/components/settingsForm/settingsForm.test.tsx` as applicable; add calendar lazy/progress and shared Skeleton, LoadingIndicator and LoadingPage tests. Browser regression: existing calendar, focus scene, task UX, settings/session and accessibility suites (Chrome, Firefox, WebKit).
- Run `cd apps/web && npm run format:check && npm run lint`; from root `make check-web-architecture typecheck test-web build-web`, then `make test-e2e` with test DB only. Run new lint fixtures as part of CI.
- No API/schema changes or production DB migration; no query policy/command idempotency changes. Implementation PR provides final audit summary and test evidence. See current validation and remaining browser limitations above.

## Implemented indicator inventory

Paths relative to `apps/web/src`; lines identify render sites at this implementation.

| File | Indicator lines |
| --- | --- |
| features/auth/components/authScreen/authScreen.tsx | 130 |
| features/calendar/components/scheduleScopeDialog/scheduleScopeDialog.tsx | 49, 64 |
| features/focus/components/timerBar/timerBar.tsx | 45, 62, 72 |
| features/focus/components/timerPanel/timerClock.tsx | 45 |
| features/focus/components/timerPanel/timerPanel.tsx | 203, 218, 232, 245, 275 |
| features/notifications/components/notificationSettings.tsx | 114, 189, 355 |
| features/settings/components/settingsForm/settingsForm.tsx | 468 |
| features/tasks/components/groups/groups.tsx | 106, 206 |
| features/tasks/components/recoveryToast/recoveryToast.tsx | 54 |
| features/tasks/components/taskDetail/completionTimeForm.tsx | 62 |
| features/tasks/components/taskDetail/taskDetail.tsx | 233, 284, 293 |
| features/tasks/components/taskEditor/taskEditor.tsx | 292 |
| features/tasks/components/taskRow/taskRow.tsx | 73 |
| home/components/homePage/homePage.tsx | 317 |
| shared/components/loadingPage/loadingPage.tsx | 11 |

## UI005 follow-up — asset ownership (planned)

Normative rules: [UI005](qualityChecks.md#ui005--asset-ownership), `apps/web/AGENTS.md`, and `apps/web/assets/README.md`.

### Complete first-party frontend asset audit

Audited head `34752838d456ae01d531ea21f19a0d7b94501fb2` (untruncated repository tree). Read all 151 non-test/non-generated TS, TSX, JS and CSS files under `apps/web/src/` and `apps/web/public/` (55 TSX, 45 CSS, 51 TS/JS). Searched literal SVG elements, image elements/imports, image data URIs, encoded SVG, Base64, CSS url/mask, DOM image creation and Lucide imports; inspected matched geometry and usage. Enumerated all tracked SVG/image assets. Also checked frontend build/config/check scripts, Cloudflare worker, build, maintenance and deployment route sources. No tracked raster/vector image files were found outside apps/web. Test fixtures, generated API types, lockfiles, third-party library internals and other backend/deployment source are outside this source audit; re-run tracked-source discovery during implementation.

| Path (relative to apps/web) | Audit finding | Required decision |
| --- | --- | --- |
| src/shared/styles/formControls.module.css:137–143 | Static select chevron embedded as data URI; encoded stroke %23687588 (#687588) | Extract to assets/icons/chevronDown.svg and use a token-colored CSS mask on appropriate wrapper/pseudo-element, or render existing Lucide ChevronDown in the control wrapper if suitable. Preserve select behavior and styling. |
| src/shared/components/loadingIndicator/loadingIndicator.tsx:10–28 | Handwritten inline SVG with fixed circle geometry and dash pattern; only outer size and CSS rotation vary | Replace handwritten SVG with the existing Lucide LoaderCircle (verify export with installed version); if preserving exact artwork requires a custom glyph, extract it to assets/icons/loadingSpinner.svg and render as a currentColor CSS mask. Prefer Lucide; do not implement both. Preserve single LoadingIndicator, size API, accessibility, currentColor, rotation and reduced motion. |
| src/features/focus/components/timerPanel/timerClock.tsx:22–32 | Two circles with strokeDashoffset calculated from ratio | Keep genuine dynamic SVG in TimerClock; preserve global focus tokens, timing and geometry. |
| src/shared/components/progressRing/progressRing.tsx and progressRing.module.css | CSS conic-gradient driven by --progress, no SVG | Keep CSS-based dynamic ring. |
| src/shared/components/loadingPage/loadingPage.tsx:11 | Composes LoadingIndicator | Keep composition; never create a separate spinner. |
| src/features/auth/components/authScreen/authScreen.tsx:13–14,29–38; src/home/components/workspaceSidebar/workspaceSidebar.tsx:6,60 | Import existing brand PNG assets | Keep imports and intrinsic palettes. |
| src/app/manifest.ts:3–4,19–20 | Imports existing Android PWA PNGs | Keep assets/icons/ and build-generated URLs. |
| src/app/favicon.ico; src/app/apple-icon.png | Next App Router metadata conventions | Keep in prescribed locations. |
| public/sw.js | Stable service worker URL, not an image | Keep unchanged; no new public image required. |

The only application-authored literal SVG implementations found are the encoded select icon, the static spinner glyph and the dynamic TimerClock. The former two require migration; the latter is an allowed dynamic SVG. No other authored image data URI or Base64 image was found in the scanned runtime. All six tracked image files are already in appropriate locations (four PNGs in assets, one PNG and one ICO in App Router).

Existing Lucide usage is compliant: accountMenu, eventContent, scheduleScopeDialog, floatingFocus, timerBar, taskDetail, recurrenceScopeDialog, taskEditor, taskRow, calendarWorkspace, taskFilters, taskListPanel, workspaceSidebar, appDialog, dialog (type import), dialogHeading, priorityBadge, sidebarPanel and toast. Do not copy these library icons into assets.

A static glyph does not qualify as a dynamic SVG just because its wrapper accepts size/color/className props, toggles visibility, or rotates/transforms it with CSS. Dynamic SVG means its internal drawing/geometry, progress or interactive elements actually depend on props/state. Prefer Lucide for fixed standard icons; otherwise extract fixed custom artwork to assets. Shared LoadingIndicator may own animation of a Lucide icon or external mask, not a duplicate handwritten SVG. 

Implementation and enforcement:
1. Audit tracked production sources for `data:image/`, encoded and Base64 image literals, static inline SVG and asset files outside designated locations; classify dynamic SVG, framework/generated resources, test fixtures and runtime/user data separately. Review the CSS/TS asset references and deployment pipeline for both normal and static export builds.
2. Migrate both confirmed violations (select chevron and LoadingIndicator glyph), and any additional confirmed authored embedded static assets discovered by the final audit. Keep all assets under one owner, with no duplicates. Verify select geometry, focus/keyboard, pointer events, disabled/invalid states, light/dark and forced colors; verify the spinner remains centered, decorative beside labels, accessible standalone and reduced-motion safe. Update existing LoadingIndicator tests for the chosen glyph without relying on a specific SVG child shape. Update assets README for additions and legitimate exceptions.
3. Extend `scripts/checkUi.mjs` and `checkUi.test.mjs` with UI005 diagnostics for authored image data URI literals (including URL-encoded SVG and Base64) in CSS/JS/TS/JSX; handle quoted CSS URLs and semicolons within data URIs rather than relying solely on the existing declaration matcher. Add positive fixtures for imported asset URLs, external SVG masks, dynamic inline SVG, Lucide and legitimate non-image data. Negative fixtures include current select SVG URI and Base64 image; add direct static inline SVG fixture coverage where practical, distinguishing a fixed spinner with size/className props from genuinely dynamic TimerClock geometry. Manual review remains necessary to classify static inline SVG and actual public URL requirements; do not claim exhaustive static analysis.
4. Update UI001 exceptions to permit intrinsic brand/illustration colors and stencil-only mask paint, not fixed theme-aware icon colors. Check all affected build modes and CI, and verify generated asset URLs, service worker registration, manifest/icon requests, select rendering and the same spinner across buttons, toasts and LoadingPage. Report any remaining documented exception.

No backend, database or service worker behavior changes are required. Previous validation applies to the earlier implementation; rerun lint fixtures, format, typecheck, architecture, unit tests and normal/static frontend builds after the UI005 implementation.
