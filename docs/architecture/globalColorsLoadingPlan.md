# Global colors and loading skeletons — implementation plan

Status: proposed; documentation only. No runtime, lint configuration, API or DB changes in this PR.

## Goals and boundaries

- All application-owned fixed UI colors live in the global color system. Components must consume semantic tokens rather than literals.
- Replace every visible text-only transient loading state with a layout-shaped skeleton (sometimes called a lazy-load block). For an action already in progress, use a compact pending indicator with a stable action label instead of replacing the surrounding content with a skeleton.
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

Non-UI exceptions: `apps/api/internal/services/groupCommands.go:21,28–29` validates six-digit hex, and `apps/api/internal/models/group.go:5` stores color as a string. Retain these. Example test-data exception: `features/tasks/components/taskDetail/historyDetail.test.tsx:37` uses `#123456` as historical group data. Do not alter fixtures that deliberately assert arbitrary persisted values. Binary branding assets/icons are out of the runtime token check; editable SVG application icons, if introduced, must use tokens/currentColor; standalone fixed branding assets must be documented. Audit any production HTML/CSS embedded in deployment scripts too; if it cannot import the application CSS, generate or import the standalone shared value rather than duplicating literals.

## 2. Loading UI

Implement exactly one shared, domain-independent public loading component: `Loading` in `src/shared/components/loading/loading.tsx`, with a colocated `loading.module.css` and tests. Every loading site must use this component, including lazy module fallbacks, inline values, pending buttons, toasts and focus settlement. No feature-local skeleton component, shimmer CSS, spinner implementation or alternative loading primitive. The shared component may use private internal helpers.

### Shared Loading contract

Proposed API (illustrative, finalize types during implementation):
- `variant`: `text` | `rect` | `circle` | `rows` | `grid` | `indicator`. Default to rect. Indicator is the compact pending presentation, not a separate public component.
- `width`, `height`, `count` (for repeated rows), `columns` (for grids), and optional constrained tone for the focus scene. Defaults live in shared CSS; no feature-defined raw colors, animation or placeholder styles.
- `label`: accessible loading status where the block owns the status; omit for decorative repeated blocks inside an already-labelled busy region. The caller owns actual query/mutation state and region aria-busy; the block never starts requests or delays rendering.
- Render valid inline markup for text/indicator variants, block-compatible markup for larger variants; no nested interactive content. Stable size, static reduced-motion mode, light/dark and focus-scene global tokens.

Example usages (not implementation in this PR):
```tsx
<Loading variant="text" width="8rem" />
<Loading variant="circle" width={48} height={48} />
<Loading variant="rows" count={5} label="Loading tasks" />
<Loading variant="grid" columns={7} label="Loading calendar" />
<button disabled={busy}>
  {busy && <Loading variant="indicator" label="Saving changes" />}
  Save changes
</button>
```

Features may compose several instances of Loading within their existing layout to match the loaded screen (e.g. a circle and text bars in a progress card). They must not recreate its visual implementation or introduce feature-specific public loading components. Use the same block in Next dynamic loading callbacks and Suspense fallbacks. Keep public feature imports and existing architecture boundaries.

- Skeletons approximate the eventual layout: rows, text bars, chips, circles, card metrics or calendar grid. Reserve dimensions and avoid scroll jumps; no placeholder buttons/links are focusable or clickable. Decorative skeletons are aria-hidden. Set aria-busy on the actual content region while it is pending, and expose one concise screen-reader-only status per region when needed, not one announcement per cell. Respect prefers-reduced-motion; static placeholders must still look correct.
- Initial data or lazy module loading: show skeleton in the existing shell. When data already exists and is being refreshed, keep it visible rather than resetting to skeleton. If a deletion preview is being revalidated, keep its action blocked until the authoritative response is ready even if previous data is displayed.
- Mutation pending: use an inline spinner/progress glyph and stable label (e.g. Save changes, Undo, Enable on this device), keep button dimensions, existing disabled/uncertain/retry semantics and accessible feedback. For the calendar saving toast, show a compact non-text progress indicator with the status message still available to assistive tech; do not remove success/error notices or the undo action.
- Focus completion confirmation is an authoritative server settlement, not a generic query: keep timer digits, existing offline/paused states and controls; replace only the transient text with a small progress indicator and accessible confirmation status. Do not claim completion early.
- Empty, disabled, offline, conflict, uncertain command, validation, and error/retry states remain explicitly distinguishable. A skeleton must end on success or terminal error; do not show an endless skeleton for an absent/disabled query or a legitimate empty result.

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

### Action/settlement pending inventory

| File | Line(s) / current text | Replacement |
| --- | --- | --- |
| features/auth/components/authScreen/authScreen.tsx | 129 Please wait… | sign-in/create account pending indicator |
| features/calendar/components/scheduleScopeDialog/scheduleScopeDialog.tsx | 43 Saving… | This and following pending indicator |
| features/focus/components/timerBar/timerBar.tsx | 39 Confirming completion… | compact settlement indicator |
| features/focus/components/timerPanel/timerClock.tsx | 41 Confirming completion… | matching settlement indicator |
| features/notifications/components/notificationSettings.tsx | 167 Enabling… | Enable on this device pending indicator |
| features/settings/components/settingsForm/settingsForm.tsx | 469 Saving… | Save changes pending indicator |
| features/tasks/components/recoveryToast/recoveryToast.tsx | 51 Restoring… | Undo pending indicator; retain Retry restore |
| features/tasks/components/taskEditor/taskEditor.tsx | 274 Saving… | Save changes/Create task pending indicator; retain Retry save |
| home/components/homePage/homePage.tsx | 297 Saving calendar change… | progress toast with accessible status |

Other matches are not loading UI: state variables in sessionProvider/useOwnedQuery/useCommand, disabled conditions (e.g. homePage:536), search/description input placeholders, daylight-saving wording, error/retry messages (Retry loading tasks/settings), offline estimates and uncertain save guidance. Preserve those behaviors and texts. Audit any future Suspense/Next loading.tsx fallback the same way; do not add a redundant route-level loading boundary just for this migration.

## 3. Implementation sequence

1. **Color foundation:** document semantic names and concrete-value bridge. Add tokens/registry, preserve current light/dark values and focus scene. Migrate CSS Modules, then TS/TSX and manifest. Verify arbitrary group colors and calendar rendering.
2. **Loading primitives:** one shared Loading (including indicator variant) and accessible status convention; add unit tests. Avoid a new dependency unless existing CSS/React cannot meet requirements.
3. **Feature migration:** session and calendar first, workspace lists/progress, settings/notifications, task detail and deletion preview, then mutations and focus settlement. Review loading versus empty/error branches individually.
4. **Enforcement:** implement a small deterministic source check in web scripts (or equivalent compatible tooling) following the existing Oxfmt/Oxlint plus architecture-check pattern. Wire into `npm run lint` or a dedicated check invoked by both local Make targets and CI. Add positive/negative fixtures. The documentation rules apply to new/changed code now; mechanical enforcement starts in the implementation PR after baseline violations are removed.
5. **Verification:** run tests and a fresh tracked-file audit. Remove temporary migration allowlists. Keep only explicit, narrowly scoped exceptions.

## 4. Lint and review strategy

See [Architecture and quality checks](qualityChecks.md#ui-color-and-loading-rules) and `apps/web/AGENTS.md` for normative rules. Suggested initial audit (from repo root, use git grep to ignore untracked build output):

```sh
git grep -nEi '#([[:xdigit:]]{8}|[[:xdigit:]]{6}|[[:xdigit:]]{4}|[[:xdigit:]]{3})([^[:xdigit:]]|$)' -- apps/web/src apps/web/public deploy apps/api api
git grep -nEi 'loading|please wait|opening your workspace|checking|saving|restoring|enabling|confirming completion|isPending|isFetching|fallback|suspense' -- apps/web/src
git grep -nE '…|\.\.\.' -- apps/web/src
```

These are discovery commands, not sufficient lint rules. Classify results rather than blindly replacing identifiers, anchor fragments, arbitrary group data, test strings, retry labels, logs, checksums or API validators. The full implementation audit should also search every tracked source extension and inspect loading fallbacks that use no obvious keyword.

- Color rule: detect exact 3/4/6/8-digit CSS hex tokens and other fixed color expressions in CSS declaration values, inline styles, CSS strings/template literals, SVG presentation attributes, manifest and library options. Prefer CSS parsing/tokenization and TypeScript AST over blanket regex; distinguish CSS IDs, URLs and unrelated strings. Allow only designated global declarations/registry, generated outputs and explicitly documented non-UI data/standalone asset exceptions. Reject local custom properties that hide raw colors.
- Loading rule: flag visible text-only loading JSX, dynamic/Suspense text fallbacks and pending labels in recognized branches, including imported string constants where practical. Require shared Loading usage/composition with accessible status. Flag duplicate feature-local loading animation/placeholder implementations in review; add lint coverage for known bypass patterns. A conservative automated heuristic plus mandatory review is preferable to claiming all React control flow is statically decidable. Allow hidden accessible status strings, retry/error labels and nonvisual logic.
- Emit actionable file:line diagnostics, rule ID and suggested replacement. Negative tests include CSS gradients/shadows, 4/8-digit alpha, inline SVG/JS colors, local variables and visible loading text; positive tests include tokens, currentColor, transparent, derived colors, group input data, manifest registry, Loading and screen-reader status. No broad per-directory production bypass.

## 5. Acceptance and regression checks

- Zero application-owned fixed UI color literals outside approved global declarations/registry or reviewed exceptions; no duplicate palette/default or manifest value. Light/dark and focus scene visual regression checked (calendar now line, event hover/preview, dialog danger hover, toast, invalid forms, sidebar and timer).
- All listed content-loading sites use shape-matched shared Loading instances; action/settlement sites use its indicator variant. No independent loading primitive, feature-local loading component, spinner or shimmer styles. No visible text-only transient loading status. No skeleton after resolved empty/error/disabled states. Background refetch retains data. Skeletons are noninteractive and reduced-motion safe.
- Test delayed initial requests, lazy module loading, slow/rejected mutations, retries, background refetch, disabled queries, navigation, account switching, offline focus and server completion confirmation. Verify deletion-preview confirmation stays blocked while fetching and recovery toast Undo behavior survives.
- Verify screen-reader busy/status, keyboard focus/tab order, stable button labels and no layout shifts in desktop/mobile. Update assertions that currently rely on visible loading strings; prefer semantic status/region or specific skeleton test IDs with delayed responses.
- Extend existing tests in `app/providers.test.tsx`, `features/tasks/components/taskDetail/{historyDetail,taskDetail}.test.tsx`, `features/focus/components/timerPanel/timerTaskSelection.test.tsx`, `features/notifications/components/notificationSettings.test.tsx`, `features/settings/components/settingsForm/settingsForm.test.tsx` as applicable; add calendar lazy/progress and shared Loading variant tests. Browser regression: existing calendar, focus scene, task UX, settings/session and accessibility suites (Chrome, Firefox, WebKit).
- Run `cd apps/web && npm run format:check && npm run lint`; from root `make check-web-architecture typecheck test-web build-web`, then `make test-e2e` with test DB only. Run new lint fixtures as part of CI.
- No API/schema changes or production DB migration; no query policy/command idempotency changes. Implementation PR provides final audit summary and test evidence. This planning PR runs no runtime tests because it changes only Markdown.
