# 16 — Proposed Code Changes & Implementation Backlog

> **Status: Proposed, not implemented.** This file records findings from reviewing TodoCal `docs/features` against the application code and the free-deployment configuration. It is a **backlog**, not a claim that the code has already changed. No items in this file should be marked Done until the corresponding code, tests, and deployments have been verified.

## Scope and order

| ID | Priority | Gap / proposal | Type | Recommended delivery |
|---|---|---|---|---|
| GAP-01 | P1 | Align Focus/Break Settings validation across web and API | Existing correctness issue | PR A: validation + unit tests |
| GAP-02 | P1 | **Edit recurrence: This occurrence / This and following** | Approved UX/business behavior change | PR B: recurring scope edit |
| GAP-03 | P1 | **Delete recurrence: This occurrence / This and following** | Approved UX/business behavior change | PR B or follow-up PR C |
| GAP-04 | P2 | Make Task delete recovery understandable (Undo vs persistent Restore/Trash) | UX/product decision | Recovery PR |
| GAP-05 | P2 | Preserve original finalized snapshot separately from adjusted values, if required | Optional data model change | History PR, after product decision |
| GAP-06 | P2 | Durable background settlement of expired Focus sessions | Infrastructure/correctness for background use | Worker/scheduler PR |
| GAP-07 | P2 | PWA Web Push and scheduled Focus/task reminders | New feature; depends on GAP-06 + scheduling infrastructure | Notifications PR |
| GAP-08 | P3 | Keyboard, dialog-focus, screen-reader, responsive PWA audits | Quality/accessibility | QA PR |

**Do not fix by changing documentation alone.** The [feature docs](README.md) describe current behavior separately; this backlog records intended future changes. Implement P1 first, then address deploy/runtime constraints before advertising background reminders.

## GAP-01 — Align Focus/Break Settings validation

**Observed code**
- `apps/api/internal/services/settingsCommands.go`: `EditSettingsCommand` currently validates all three duration values only as positive integers up to 2,147,483,647.
- `apps/web/src/features/settings/components/settingsForm/settingsForm.tsx`: UI input limits are Focus 1–180, Short Break 1–60, Long Break 1–60 minutes.
- `apps/api/internal/services/focusService.go` accepts optional per-session override 1–180; task-specific `focusMinutes` validation is already 1–180.

**Proposed change**
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

### Edit — proposed implementation

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

### Delete — proposed implementation

- **This occurrence:** soft-delete the selected task (or create a cancellation exception for an unmaterialized slot); preserve other occurrences and the original-slot tombstone.
- **This and following:** cut off the series **before the selected original slot**, cancel all subsequent unmaterialized slots, and soft-delete all materialized selected/future scheduled occurrences **from the active calendar**. This includes already-completed future tasks only after a warning/explicit confirmation; **never physically delete** their completed/Focus history or journal.
- Past/finalized occurrence entries and reports remain untouched. Keep soft-deleted IDs and original-slot/tombstone records so a later Materialize/read never resurrects the tail. Do not use the current `Stop(today)` implementation to simulate deletion from a future selected date.
- Design **Undo/Restore** as one atomic revision-checked series operation with an explicit server-side validity policy; the current 10-second *toast* is not an enforced recovery deadline. Conflicting later changes must fail safely without partial restoration.

### UI and API work

**Candidate code touchpoints (not yet edited):**
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

## GAP-04 — Task deletion recovery: Undo versus Trash

**Observed:** `apps/web/src/features/tasks/components/recoveryToast/recoveryToast.tsx` hides Undo after approximately ten seconds, while `apps/api/internal/services/history.go` can restore a soft-deleted task without an elapsed-time check when `expectedRevision` matches.

**Proposed UX:** retain the immediate `Task deleted · Undo` feedback and provide a **Recently Deleted / Trash** recovery path for soft-deleted tasks. Decide a retention period separately; do **not** infer backend expiry from the toast. List deletion time, task title, original schedule and recover action; restore should use revision validation. Handle recurring single-occurrence deletions vs tail deletions distinctly.

**Acceptance:** after the toast disappears, the user can locate and restore a recoverable task through the designed UI; no hidden permanent data loss and no cross-account recovery.

## GAP-05 — Original historical snapshot baseline (optional)

**Observed:** `apps/api/internal/services/history.go` `refreshHistorical` updates `daily_plan_entries` and recounts `daily_snapshots`. `task_events` retains before/after states, but there is no separately persisted immutable "original finalized" metric.

**Decision needed:** Does the app need **Original plan vs Adjusted plan** comparison, or is an auditable adjusted view enough? If **yes**, add immutable finalized baseline/version tables or fields and explicitly recorded adjustments, with migration and clear as-of semantics; preserve current analytics behavior for existing consumers until updated.

**Acceptance if implemented:** a backdated edit changes adjusted numbers, never the original baseline; group removal alone does not touch historical totals; report/UI can show both labeled values. **Not mandatory for the P1 PRs.**

## GAP-06 — Durable Focus completion and deployment

**Observed:** `apps/api/internal/services/focusService.go` settles expired running sessions on relevant Focus reads/commands. The current planning sweeper (`apps/api/internal/workers/sweeper.go`) runs planning `WithTx`, not proactive Focus completion. The live free deployment (`render.yaml` and `deploy/README.md`) has a web API but **no separate always-on worker**.

**Proposed change:** make expired Focus session reconciliation idempotent and runnable by a scheduled job outside user browser tabs. Preserve the logical completion timestamp (target reach), one Pomodoro, closed focus intervals and dependent analytics/cache consistency. Pick a real scheduler compatible with the chosen hosting plan; **Render Free process sleeping cannot guarantee minute-accurate cron inside the API**. Design for late or repeated job delivery and monitor backlog.

**Acceptance:** a fully closed browser does not block eventual server settlement; duplicate sweeps cannot double-count; offline/paused sessions and mid-night boundaries remain correct; report totals agree after catch-up.

## GAP-07 — PWA Web Push and scheduled reminders (new feature)

**Dependency:** GAP-06 plus reliable scheduled delivery, Push API/service worker and subscriptions. Existing `apps/web/src/app/manifest.ts` supports installability metadata, **not background notifications by itself**.

**Proposed:** opt-in per-device browser push subscriptions with VAPID, private token storage, preferences (Focus schedule start, optional lead minutes, task deadline, Pomodoro end, breaks), dedupe IDs, quiet hours, account-local timezone, DST handling and retry/backoff. Notification click routes to the task/Focus screen after auth. A scheduled Focus **reminder does not start a timer automatically**.

**Acceptance:** supported installed/background clients receive notifications when allowed, while denied permission does not block TodoCal. Delivery is best effort, never promised to the exact second. Test multiple devices, logout/revocation, duplicate retries, changed/deleted schedules and browser/OS constraints.

See [PWA and notifications](12-pwa-notifications.md).

## GAP-08 — Accessibility and responsive behavior

**Proposed QA:** add keyboard-only/E2E checks for task edit/delete/restoration, recurrence scope dialogs, calendar drag alternatives, modal focus trap/return, screen-reader progress labels, timer announcements, light/dark contrast, reduced-motion, 1024px desktop baseline and smaller PWA windows.

**Acceptance:** no mandatory pointer-only action, no noisy sub-second live announcements, and no loss of form draft on 409/offline retry. Treat mobile optimization as an explicit product scope decision rather than assuming installed PWA implies native-like mobile UI. See [UX & accessibility](14-ux-accessibility.md).

## Implementation and release checklist

- **PR A:** settings validation + tests; minimal API-safe, independent of recurrence.
- **PR B:** recurrence **This and following** **edit** with split, migration-aware data preservation, tests and UX.
- **PR C:** recurrence **This and following** **delete** + atomic recovery; can be combined with PR B only if both are fully tested.
- **PR D:** Trash/recovery policy and UI; historical baseline only if explicitly chosen.
- **PR E:** settle Focus in an actually scheduled process; then Web Push/reminder infrastructure and permission controls.
- **PR F:** accessibility regression tests and remaining UX polish.
- Deploy backward-compatible API/migrations **before** any frontend that depends on new recurrence or push routes. Frontend and Render API deploy separately in the current hosting setup.
- Every delivered gap updates its related `docs/features` specification and acceptance scenarios, and gets Go/web tests. No source changes, database migrations or infrastructure changes are included in this documentation PR.

## Out of scope / already working

Do **not** modify these solely to match an outdated doc: `No plan` (null) versus `0%`, server-enforced **single-task schedule Undo**, per-account idempotency receipts, overall calendar progress independent of filter, group deletion retaining historical totals, or password change revoking other (not current) login sessions.
