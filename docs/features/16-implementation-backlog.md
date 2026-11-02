# 16 — Implementation Backlog & Verification

> **Status: Implemented in one PR; local verification is recorded below.** The original review findings are retained as baseline context. Production scheduler configuration and real-device Web Push delivery remain release checks; they are not claimed by local tests.

## Scope decision — 2026-11-01

The owner excluded **Trash / Recently Deleted** and **GAP-05 immutable historical baselines** from this implementation. Keep the existing immediate Undo and revision-checked restore API; do not add retention, purge, or a persistent deleted-task browser. Historical reports continue to use adjusted snapshots and the event journal. GAP-01, GAP-02/03, GAP-06/07 and GAP-08/09 remain in scope.

**Delivery decision (2026-11-01):** Ship all in-scope implementation in **one PR** on `codex/feature-backlog-implementation`. The sections below are work items, not separate PRs. Verify each subsystem independently inside the same PR.

## Scope and order

| ID | Priority | Gap / proposal | Type | Work item in the single PR |
|---|---|---|---|---|
| GAP-01 | P1 | Align Focus/Break Settings validation across web and API | Existing correctness issue | Settings: validation + unit tests |
| GAP-02 | P1 | **Edit recurrence: This occurrence / This and following** | Approved UX/business behavior change | Recurrence: recurring scope edit |
| GAP-03 | P1 | **Delete recurrence: This occurrence / This and following** | Approved UX/business behavior change | Recurrence delete + recovery |
| GAP-04 | — | Existing Undo and restore semantics only; no Trash | Excluded feature | Document existing behavior |
| GAP-05 | — | Original immutable historical baseline | Excluded by owner | No implementation |
| GAP-06 | P2 | Durable background settlement of expired Focus sessions | Infrastructure/correctness for background use | Worker/scheduler |
| GAP-07 | P2 | PWA Web Push and scheduled Focus/task reminders | New feature; depends on GAP-06 + scheduling infrastructure | Notifications |
| GAP-08 | P1 | Fix documented accessibility findings; keyboard, dialog-focus and responsive audits | Existing accessibility finding + QA | Accessibility fixes and regression tests |
| GAP-09 | P1 | Repair existing E2E baseline and map tests to current acceptance scenarios | Test-contract alignment + unresolved interaction reports | E2E stabilization and coverage audit |

**Do not fix by changing documentation alone.** The [feature docs](README.md) describe current behavior separately; this backlog records the agreed changes and their verification. Address P1 issues first, including existing E2E baseline reliability. The E2E audit (GAP-09) is **separate from implementing new feature behavior**; future scenarios remain deferred until shipped. Do not advertise background reminders before the required deployment infrastructure exists.

## GAP-01 — Align Focus/Break Settings validation

**Baseline before implementation**
- `apps/api/internal/services/settingsCommands.go`: `EditSettingsCommand` currently validates all three duration values only as positive integers up to 2,147,483,647.
- `apps/web/src/features/settings/components/settingsForm/settingsForm.tsx`: UI input limits are Focus 1–180, Short Break 1–60, Long Break 1–60 minutes.
- `apps/api/internal/services/focusService.go` accepts optional per-session override 1–180; task-specific `focusMinutes` validation is already 1–180.

**Implemented change**
- Define one product contract for *settings*: Focus 1–180, Short/Long Break 1–60 minutes. Enforce it in the **Go service**, not only in HTML inputs; keep API schema/client validation and error messages in sync.
- Validate values **again when a timer starts** (particularly defaults read from persisted settings), or explicitly normalize any legacy out-of-range values through a safe migration.
- Do not retroactively change duration/elapsed time of a running or completed session.

**Acceptance:** Direct API calls with 0, negative, over-limit, or non-integer input fail consistently; boundary values succeed; changing defaults does not mutate an active session. Add Go validation tests, endpoint tests, and web form checks.

## GAP-02 / 03 — Recurrence Edit and Delete: This and following

### Product decision

**Use only two clear choices for both Edit and Delete on a recurring occurrence:**

1. **This occurrence** — only the selected occurrence changes; other dates follow their existing recurrence behavior.
2. **This and following** — the **selected original occurrence slot** and all later slots in the same recurrence series are affected. Slots before it remain unchanged, even if they are after *today*.

**No ambiguous "All occurrences from today" action in the new editor/delete confirmation.** Do not silently reinterpret existing `scope: "all"` clients: use an explicit new scope/endpoint and deploy backward-compatible API and UI changes in order.

Example: today is 10 Nov; a daily occurrence on **15 Nov** is selected. **This and following** changes/cancels 15 Nov onward; **10–14 Nov remain unchanged**. The cutoff is anchored on `original_occurrence_date`, not a moved occurrence's effective `scheduled_date`; show the user what slot they are affecting if the task was moved.

### Edit — implementation

- **This occurrence:** keep the existing per-task edit with stable task ID; do not rewrite the series template or sibling occurrences.
- **This and following:** split the recurrence into a **preserved head** and a **new tail series** at the selected original slot:
  1. Validate `expectedRevision` on the selected task and `expectedSeriesRevision` on the parent series under the existing per-account transaction lock.
  2. End the head **just before** the selected original slot in recurrence terms. Preserve original head history, cadence anchor, exceptions and finalized snapshot entries.
  3. Create the new tail series with the requested template/rule and correct local-date cadence anchor. Only its selected-and-future slots use the new rule.
  4. Reconcile existing materialized tail occurrences by preserving stable task IDs and associated focus/history data. Re-key their series/slot membership safely or keep an explicit mapping/tombstones so old slots cannot regenerate; migrate relevant moved/deleted exceptions.
  5. **Do not silently rewrite already-completed future occurrences or sessions with historical Focus evidence.** Keep their accepted values and prevent duplicate generation; if an update cannot preserve them safely, reject with a clear conflict/preview rather than discarding history.
  6. Apply the split and materialization guards atomically with one idempotency receipt. Rerunning a retried command must not produce a second tail series.

- A selected **past** or finalized slot should not implicitly rewrite finalized siblings. Limit the new `This and following` operation to current/future selected original slots and explain the limitation; a single historical task can still be edited via the existing historical-adjustment path.
- The recurrence **rule itself** (daily / weekly / interval) may change for the tail; changing cadence or timezone must not create duplicate or invalid local-time occurrences.

### Delete — implementation

- **This occurrence:** soft-delete the selected task (or create a cancellation exception for an unmaterialized slot); preserve other occurrences and the original-slot tombstone.
- **This and following:** cut off the series **before the selected original slot**, cancel all subsequent unmaterialized slots, and soft-delete all materialized selected/future scheduled occurrences **from the active calendar**. This includes already-completed future tasks only after a warning/explicit confirmation; **never physically delete** their completed/Focus history or journal.
- Past/finalized occurrence entries and reports remain untouched. Keep soft-deleted IDs and original-slot/tombstone records so a later Materialize/read never resurrects the tail. Do not use the current `Stop(today)` implementation to simulate deletion from a future selected date.
- Design **Undo/Restore** as one atomic revision-checked series operation with an explicit server-side validity policy; the current 10-second *toast* is not an enforced recovery deadline. Conflicting later changes must fail safely without partial restoration.

### UI and API work

**Implementation touchpoints:**
- Web: `apps/web/src/features/tasks/components/taskEditor/taskEditor.tsx`, recurring delete confirmation/dialog, `apps/web/src/features/calendar/components/scheduleScopeDialog/scheduleScopeDialog.tsx`, schedule hook and relevant task detail actions.
- Go: `apps/api/internal/services/recurrenceService.go` (`UpdateFromTask` / `Stop`), `apps/api/internal/services/taskCommands.go`, `apps/api/internal/repository/recurrenceRepository.go`, command parsing, controller routes/OpenAPI, database migrations if needed.
- Add concise preview text for the cutoff: "Change/delete this task and future repetitions starting [date]. Earlier repetitions stay unchanged." Show counts for affected, completed, moved and previously deleted occurrences when available.
- Keep explicit request idempotency and optimistic revisions. Do not break old frontends when the API deployment precedes the new frontend.

### Recurrence acceptance tests

1. Selected 15 Nov; editing/deleting **This and following** does not modify 10–14 Nov, even when they remain in the future.
2. **This occurrence** leaves sibling fields, cadence and dates intact; deleting it never regenerates the original slot.
3. New tail recurrence changes cadence/interval/date without altering prior history; repeated reads and retries never duplicate occurrences or series.
4. A moved occurrence selects the cutoff via its **original** slot; moved exceptions survive the split.
5. Already-completed future tasks, existing Focus sessions, explicitly canceled slots and prior finalized snapshots are never physically lost. A future completed task included in a **following delete** is hidden from active scheduling only after user confirmation.
6. DST gap/overlap and timezone changes do not create invalid or duplicate slots.
7. Two concurrent commands with stale revisions yield one winner and a 409; Undo is atomic and cannot restore over an intervening change.
8. Edit/Delete dialogs show the same two scopes and do not call old `scope: all` for `This and following`.

See [recurrence current implementation](06-recurrence.md) and [acceptance scenarios](15-acceptance-scenarios.md).

## GAP-04 — Existing deletion recovery; no Trash

**Decision (2026-11-01):** Do not add Trash / Recently Deleted. Preserve the immediate **Task deleted · Undo** toast and the existing revision-checked restore API. The approximately ten-second toast is a UI visibility period, not a backend retention deadline. Do not add automatic purge or imply that expiry makes a deletion permanent. Series-tail deletion still needs its own atomic Undo under GAP-03.

## GAP-05 — Immutable historical baseline excluded

**Decision (2026-11-01):** Do not implement separate original snapshots, baseline/version tables, or an Original vs Adjusted report. Keep adjusted snapshots plus the event journal. Explicit historical edits may change historical totals; group deletion alone does not.

## GAP-06 — Durable Focus completion and deployment

**Baseline before implementation:** `apps/api/internal/services/focusService.go` settles expired running sessions on relevant Focus reads/commands. The current planning sweeper (`apps/api/internal/workers/sweeper.go`) runs planning `WithTx`, not proactive Focus completion. The live free deployment (`render.yaml` and `deploy/README.md`) has a web API but **no separate always-on worker**.

**Implemented change:** make expired Focus session reconciliation idempotent and runnable by a scheduled job outside user browser tabs. Preserve the logical completion timestamp (target reach), one Pomodoro, closed focus intervals and dependent analytics/cache consistency. Pick a real scheduler compatible with the chosen hosting plan; **Render Free process sleeping cannot guarantee minute-accurate cron inside the API**. Design for late or repeated job delivery and monitor backlog.

**Acceptance:** a fully closed browser does not block eventual server settlement; duplicate sweeps cannot double-count; offline/paused sessions and mid-night boundaries remain correct; report totals agree after catch-up.

## GAP-07 — PWA Web Push and scheduled reminders (new feature)

**Dependency:** GAP-06 plus reliable scheduled delivery, Push API/service worker and subscriptions. Existing `apps/web/src/app/manifest.ts` supports installability metadata, **not background notifications by itself**.

**Implemented:** opt-in per-device browser push subscriptions with VAPID, private token storage, preferences (Focus schedule start, optional lead minutes, task deadline, Pomodoro end, breaks), dedupe IDs, quiet hours, account-local timezone, DST handling and retry/backoff. Notification click routes to the task/Focus screen after auth. A scheduled Focus **reminder does not start a timer automatically**.

**Acceptance:** supported installed/background clients receive notifications when allowed, while denied permission does not block TodoCal. Delivery is best effort, never promised to the exact second. Test multiple devices, logout/revocation, duplicate retries, changed/deleted schedules and browser/OS constraints.

See [PWA and notifications](12-pwa-notifications.md).

## GAP-08 — Accessibility and responsive behavior

**Priority: P1 for observed accessibility defects; broader responsive/PWA polish can remain P2/P3.** An existing structure-refactor verification report found a serious axe \`aria-prohibited-attr\` violation on the authentication \`div.brand\` (an \`aria-label\` on an element without a supporting role). This PR gives the auth mark image semantics and fixes the reported account-menu focus return. The same report records a **WebKit account-popover focus-return failure** after Escape (popover closed but focus did not return to its trigger), reproduced against the pre-refactor baseline. These are **observed test findings**, not newly introduced structure-refactor regressions.

**Required work:**
- Fix the auth-brand accessible-name/role pattern and add a focused axe/browser regression for Sign in and Register. Prefer appropriate semantic markup or a labeled element that actually exposes the expected accessibility role; do not suppress the axe rule.
- Investigate the Account popover's native popover keyboard/close behavior, especially Escape and focus return in WebKit. Preserve Chromium/Firefox behavior; use accessible trigger, visibility and focus assertions rather than depending on implementation-specific classes.
- Extend keyboard-only/E2E checks for task edit/delete/restoration, recurrence scope dialogs, calendar drag alternatives, modal focus trap/return, screen-reader progress labels, timer announcements, light/dark contrast, reduced-motion, 1024px desktop baseline and smaller PWA windows.
- Avoid a noisy sub-second live-region timer loop; keep keyboard-only paths for every essential action. The product remains desktop-first until smaller PWA layouts are explicitly accepted.

**Acceptance:** axe A/AA checks have no unexplained serious violations on auth/workspace flows; closing a popover or dialog restores focus appropriately on supported engines; keyboard actions, draft recovery and screen-reader announcements remain usable. Verify with Chromium, Firefox and WebKit where practical; document browser-specific exceptions rather than silently disabling tests. See [UX & accessibility](14-ux-accessibility.md).

## GAP-09 — E2E test reliability and acceptance-scenario coverage

**Priority: P1 for restoring a trustworthy test baseline.** This is a quality and contract-alignment task, not permission to change user-facing behavior just to satisfy stale locators. A prior structure-refactor report recorded **Chrome 30 passed / 16 failed** after the refactor versus **29 passed / the same 16 failed** on a separately tested pre-refactor baseline. Selected checks reported Chrome 12/12, Firefox 12/12 and WebKit 11/12; the additional WebKit popover focus issue also reproduced on the earlier baseline. The report did **not** run full Firefox/WebKit suites. These numbers are **historical report evidence**, not a fresh CI result or proof that all failures share one root cause.

### Classification required before changing code or tests

Classify each failing test as **(A) outdated test contract/locator**, **(B) confirmed application/accessibility defect**, or **(C) unresolved — reproduce and diagnose**. Record the affected test, expected behavior from current feature docs, observed behavior, root cause/evidence, fix and regression coverage. Do not weaken assertions, replace meaningful checks with sleeps, or change product behavior solely to make an outdated test pass.

| Reported E2E failure(s) | Initial classification / verification action |
|---|---|
| \`acceptance.spec.ts\` keyboard validation | **A candidate:** test expects \`.form-validation[role=alert]\` and old wording; current shared \`ValidatedForm\` uses \`.field-error[role=alert]\` and derives required-field text from the label. Assert accessible error and focused invalid field, not obsolete CSS. |
| \`focus.spec.ts\`, \`storage.spec.ts\`, timer parts of \`accessibility.spec.ts\` | **A candidates:** current \`TimerPanel\` is \`role="dialog"\` with \`aria-label="Focus timer"\` and start button **Start session**, not a \`Focus timer\` region with \`Focus 25…\` action. Update locators while keeping actual session/retry assertions. |
| \`home.spec.ts\` task without timer, sign-out, recurrence stop | **A candidates:** current task detail says **No focus goal** (not **Not needed**); Sign out is inside the Account popover; current recurring stop action says **Stop repeating** (not **Stop repeating after today**). Keep tests for the underlying feature semantics. |
| \`dialog.spec.ts\` draft after **Discard changes** | **A candidate:** explicit discard currently clears the saved editor draft. The test should assert the approved discard-versus-keep distinction; do not preserve discarded state just to match a stale expectation. |
| \`focusScene.spec.ts\` selected-task option | **C:** inspect the task list returned for the selected date and the exact accessible option label. Reproduce before deciding whether the selector, task filtering or state is wrong. |
| \`criteria.spec.ts\` overlapping event click blocked by \`Focus timer\` dialog | **C:** inspect dialog overlay/visibility, event pointer targeting and whether the test needs to close a user-opened dialog; verify all overlapping events remain selectable without forcing clicks through a legitimate modal. |
| \`criteria.spec.ts\` appearance + active Focus state and \`focus.spec.ts\` persistence | **C:** first align Focus locators, then verify server-confirmed active session, cache refresh, reload and cross-device display. Do not conclude timer persistence is broken from a missing old role/name. |
| \`draftPreview.spec.ts\` changed draft preview lacks the expected time text | **C:** input time updated, but compact/FullCalendar rendering may omit textual time. Verify visual and accessible time information against [Calendar behavior](04-calendar-display.md) before changing preview UI or assertion. |
| \`focus.spec.ts\` notification permission denial | **C:** check actual permission message and whether the button is visible for the simulated permission state; preserve the requirement that denied notification permission never blocks a Focus session. |
| \`toast.spec.ts\` past-date warning | **C:** distinguish creating a new task on a past date from editing an existing historical task. Current backend allows controlled historical adjustments; do not enforce a blanket “past days read-only” rule merely because an old test expects that toast. |
| \`accessibility.spec.ts\` auth-brand axe violation; \`accountMenu.spec.ts\` WebKit focus return | **B candidates with observed evidence:** track the markup violation and browser focus behavior under **GAP-08**; rerun before marking fixed. |

### Coverage mapping against 15 — Cross-feature Acceptance Scenarios

Use [\`15-acceptance-scenarios.md\`](15-acceptance-scenarios.md) as the **acceptance contract**, not a literal mandate to create 25 Playwright tests. Create and maintain a tracking table with columns:

\`Scenario ID → Current or proposed → Required test level → Existing test file/case → Missing assertion(s) → Status → Evidence/CI link\`.

**Test-level guidance:**

| Scenario IDs in doc 15 | Preferred verification | Coverage expectation |
|---|---|---|
| **1–6** (Task history, daily/period analytics) | Go service/integration for state/history/counting; FE component/E2E for deletion/restore, history and **No plan** presentation | Cover existing behavior now; E2E only for meaningful user workflows |
| **7–11** (Recurrence) | Go integration for materialization/slot identity/DST/revision; E2E for current single/all/stop/restore dialogs | Cover **current** scopes, do not assert future **This and following** behavior yet |
| **12–17** (Focus, retries, conflicts, Undo) | Go integration for timing/idempotency/revisions/token expiry; FE hook/component tests; E2E for session persistence, task independence, uncertain retry and visible Undo | Cover existing behavior now; keep server assertions authoritative |
| **18** (Monitoring) | Go/concurrency/service tests for rate budget and scrubbing; targeted web tests as needed | Not a mandatory browser E2E |
| **19–23** (Implemented) | Worker, notification and following-scope regressions | Local tests apply; real-device notification delivery remains a deployment gate |
| **24–25** | 24 excluded; 25 deferred | No immutable-baseline or offline-write feature |

Do **not** change \`15-acceptance-scenarios.md\` merely to reconcile stale Playwright selectors. Update an acceptance scenario only after confirming that the actual approved product contract changed, then update feature docs and tests together.

### Delivery and acceptance

1. Re-run existing Chrome E2E tests on a clean, isolated current branch/database/ports; collect traces/screenshots and reproduce the known failures. Capture baseline before fixes.
2. Fix **A** by modernizing locators/expectations to semantic roles, names and accepted UX; preserve substantive assertions. Fix verified **B** with product-code changes and regression tests. Investigate **C** rather than guessing.
3. Complete the scenario-to-test mapping above and add only **missing relevant coverage**, across Go unit/integration, frontend unit/component and browser E2E.
4. Run targeted Chromium, Firefox and WebKit checks for keyboard, dialogs, Account popover, Calendar events, Focus and accessibility; then the full intended browser suite. Record tests skipped because of environment limitations.
5. Once baseline reliability and isolated fixtures are established, **enable E2E as a blocking CI gate**, preferably a dedicated job with an isolated test database, installed browsers and stable test ports. Do not add an always-failing E2E job or silence persistent failures with blind retries.

**Acceptance:** all existing **current-contract** acceptance scenarios have appropriate verified coverage or an explicitly tracked gap, every known failing E2E has a documented classification and resolution, and CI can fail on a real behavior regression. Do not claim “green E2E” until a full, relevant run actually passes. Proposed scenarios remain unverified until their features ship; scenario 24 is excluded and scenario 25 remains deferred. This implementation PR includes application code, migrations, E2E fixes and CI gates.

## Implementation and release checklist — one PR

All items below belong to **one implementation PR**. They are verification milestones, not PR A–G.

- Settings duration validation, schema and regression tests (GAP-01).
- Recurrence **This and following** edit with split and history preservation (GAP-02).
- Recurrence **This and following** delete with atomic Undo (GAP-03).
- No Trash UI or immutable historical baseline (GAP-04/05 excluded).
- Scheduled Focus settlement, then Web Push/reminders and permission controls (GAP-06/07).
- Auth-brand and Account-popover accessibility fixes, then remaining UX checks (GAP-08).
- Classify E2E failures, maintain scenario-to-test coverage and enable CI only after a reliable baseline (GAP-09).
- Deploy backward-compatible API/migrations **before** any frontend that depends on new recurrence or push routes. Frontend and Render API deploy separately in the current hosting setup.
- Every delivered gap updates its related `docs/features` specification and acceptance scenarios **only when the agreed behavior changes**, and gets appropriate Go/web regression tests. Test-only locator alignment is tracked under GAP-09, not treated as a product spec change.
- The scenario-to-test matrix should distinguish **verified** from **missing/unverified** coverage; do not require one E2E per scenario or mark future scenarios as existing features.
- Source, migrations, tests, CI and documentation ship together in this one PR.

## Out of scope / already working

Do **not** modify these solely to match an outdated doc: `No plan` (null) versus `0%`, server-enforced **single-task schedule Undo**, per-account idempotency receipts, overall calendar progress independent of filter, group deletion retaining historical totals, or password change revoking other (not current) login sessions.

## Implementation verification record — 2026-11-02

| Work item | Implemented and checked locally | Deployment boundary |
|---|---|---|
| GAP-01 | Shared service duration bounds; settings and legacy-default API tests; web validation | Existing sessions keep their targets |
| GAP-02/03 | Original-slot tail split/delete, cadence changes, preserved IDs/history/exceptions, atomic revision-checked Undo; API and browser regressions | Keep legacy all/stop routes for older clients |
| GAP-06 | Idempotent Focus settlement, authenticated bounded job endpoint, Cloudflare cron, recurring reminder horizons including early deadlines and delayed runs | Configure JOBS_SECRET and deploy scheduler |
| GAP-07 | Device opt-in/revocation, preferences, durable outbox, private payloads, retries, quiet hours, logout, earlier DST-overlap resolution; service/API/component tests | Configure VAPID; actual provider/closed-app delivery requires real-device release verification |
| GAP-08/09 | Auth semantics, Escape focus return, timer labels, live calendar labels, modal Tab traversal and WebKit quick-Focus pointer behavior; isolated CI browser jobs | No claim of manual screen-reader or mobile certification |
| GAP-04/05 | Excluded as requested | No Trash or immutable-baseline implementation |

Final local E2E: **Chrome 46 passed, Firefox 46 passed, WebKit 46 passed**. Web tests: **96 passed**. API tests run with race detection and separate controller/notification databases. Edge/service-worker tests: **7 passed**. API build/vet, frontend typecheck and formatting checks passed. The production static build and Cloudflare Worker dry-run also passed; no deployment was performed. See [acceptance coverage](15-acceptance-scenarios.md) for remaining explicitly tracked edge cases.

The old failures were classified and resolved: stale locators/expected controls were aligned with current behavior; actual bugs included stale calendar accessible names, auth/account/timer semantics, WebKit modal Tab traversal and quick-Focus pointer retargeting. Axe now waits for finite color transitions to settle before measuring contrast; no rules are disabled and no blind retries were added. Backend review also found and fixed early recurring deadline materialization and inconsistent DST-overlap reminder timing.

All implementation, migrations, tests, CI and docs are delivered together. Live service configuration and deployment are not performed by this PR.
