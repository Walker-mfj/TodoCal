# MVP acceptance and operations

Scope: Clear Week desktop web MVP on Next.js, Go and PostgreSQL. Local acceptance is separate from public deployment. Chat remains Vietnamese; application copy and project documentation are English.

## Evidence index

- `apps/web/tests/e2e/workspace.spec.ts`: account isolation after session loss, second browser persistence, task/recurrence/group flows, stale revisions, offline/reconnect, light/dark, calendar click/selection.
- `apps/web/tests/e2e/calendar.spec.ts`: drag, resize, Undo, external scheduling, uncertain retry, immediate new-task visibility, custom inline validation.
- `apps/web/tests/e2e/focus.spec.ts`: independent optional timer, reload/multiple browsers, denied notifications, retry without duplicate sessions.
- `apps/web/tests/e2e/analytics.spec.ts`: weighted totals, distinct completions, daily drilldown, week/month navigation and theme.
- `apps/web/tests/e2e/acceptance.spec.ts`: keyboard-only registration/create/complete, custom invalid-field focus, 300-character titles, empty states, 1024/1440 layouts in both themes. Theme selection is a separate layout check using a native select; this is not an exhaustive keyboard or screen-reader audit.
- `apps/api/internal/server/*_test.go`: real PostgreSQL ownership, transactional rollback, concurrency, recurrence, DST, immutable history, focus and analytics tests. Tests inject a clock to exercise exact boundaries without waiting days.
- `scripts/test-operations.py`: disposable PostgreSQL 18 container, schema 5 → 6 → 5 → 6, repeat migrations, database outage/restart while the same API stays running, custom-format dump/restore and equality of every public table's rows plus identity sequence continuity. The development database is never restarted, truncated or restored over.

## Acceptance traceability

All numbers refer to section 12 of the approved specification. This table names the evidence; automated coverage is not a claim of certification across every browser or assistive technology.

| Criteria | Evidence |
| --- | --- |
| 1 | Workspace browser journey opens current Week; Calendar initially uses `timeGridWeek`. |
| 2, 10, 22 | Workspace and acceptance journeys create/complete a title-only task without a timer and reload persisted data. |
| 3 | Workspace journey checks click 09:00–09:30 and drag 09:00–10:30. |
| 4 | Calendar external untimed drop test; editor preserves absent times; Month date clicks use date-only values. |
| 5, 6, 8 | Calendar gesture browser journey and `TestScheduleUndoPreservesTaskAndDailyPlans`. |
| 7 | FullCalendar overlap layout and event selection; visual inspection of ordinary calendar. Dense overlap stress testing remains outside this pass. |
| 9, 15, 19, 20 | `TestDailyHistoryCarryoverAndProgress`, `TestDelayedCatchupAndTimezoneSnapshotProtection`, `TestTimezoneForwardPreservesExistingDayPlan`. |
| 11, 12, 13 | Planning integration tests and frontend progress-model tests recompute numerator/denominator after additions and reopening. |
| 14, 32 | No-plan/future model tests, analytics browser checks and empty-state screenshots. |
| 16, 18, 21 | `TestPeriodWeightedPlansDistinctEventsAndReopen` checks weighted 1/10, unscheduled completions and future exclusion. |
| 17 | Workspace browser journey changes filters while overall progress stays unchanged. |
| 23, 24, 25, 26 | `TestFocusElapsedPauseCatchupAndIndependence`; focus browser journey verifies task/timer independence. |
| 27, 48 | `TestFocusConcurrentDevicesOwnershipAndRevisions`, focus browser reload/multiple-device journey. |
| 28 | `TestAnalyticsFocusMidnightPausesAndActiveReconciliation`, `TestAnalyticsPomodoroAtExactMidnightBelongsToNewDay`. |
| 29 | Notification-denial browser journey. |
| 30, 31 | Analytics browser journey; aggregate/day integration tests, including focus reconciliation. |
| 33 | Workspace second-browser theme persistence and acceptance screenshots at both widths/themes. |
| 34 | Workspace retains report/editor/timer state independently from appearance; analytics selection checks and focus persistence tests cover constituent state. A simultaneous appearance change with every state active has not been separately automated. |
| 35, 36 | Exact-ratio progress model tests, shared ring/color components and analytics screenshots; 100% retains label plus checkmark. |
| 37, 38, 39 | `TestRecurrenceCadenceAndInclusiveEnd`, `TestRecurrenceValidationDeadlineAndIndependentCompletion`; form cadence/end-date controls. |
| 40, 41, 42 | `TestLazyRecurrenceExceptionsAndStop`, `TestCatchupAcrossSeveralBatchesAndStopPreservesHistory`, recurrence/stop browser journey. |
| 43 | `TestAuthLifecycle`, validation/security tests, expired-session browser journey. |
| 44 | Task/group/series/focus/analytics ownership integration tests and account-switch browser journey. |
| 45 | Second-browser workspace journey, database-authoritative reads and restart/restore test. |
| 46 | Concurrent/idempotent task integration tests, rollback tests, uncertain calendar/timer browser retries. |
| 47 | Workspace stale-edit browser journey, revision/Undo conflict integration tests. |
| 49 | Worker/API concurrency, interrupted sweep, fairness, multi-batch downtime catch-up integration tests. |
| 50 | Offline/reconnect workspace journey, authoritative focus refresh and account theme persistence. |

## Final review

Fresh whole-branch reviewer inspected `5ce9481..9b6034a` against the five plan review concerns. No critical issue; one important finding: reopening after a timezone round trip could invalidate an already-finalized completion event. `TestReopenOnRevisitedFinalizedDatePreservesCompletionHistory` failed for both planned and completion-only dates before the fix, then passed. Invalidation now respects both persisted snapshots and the catch-up watermark. Existing same-day reopening remains covered.

The reviewer deliberately did not run integration tests concurrently with the author. Final acceptance additions are author-verified. Public deployment, large-account load, exhaustive accessibility and exhaustive OpenAPI parity were not independently certified.

## Known limits

- Desktop Chrome is the automated browser target; Safari/Firefox, mobile and screen-reader certification are not claimed.
- Storage-denied or full sessionStorage can interrupt command persistence. Normal browser storage is required for the current draft/retry workflow.
- Noncanonical UUID spellings can yield a server error rather than a validation error; UI-generated canonical IDs work.
- Weekly recurrence summary does not spell out its weekday; the start date remains visible.
- Large-account performance, auth/receipt pruning, trusted proxy policy and public deployment hardening remain operational follow-ups.
- Email verification, forgotten-password recovery, offline write queues, push notifications with the app closed and background automatic breaks are outside this MVP.
- Notifications require explicit browser permission. Denial does not block task or timer flows. Sound/background delivery depends on browser permissions and throttling.
- Focus days use the current account timezone; historical task plans retain their saved timezone. Day details label the focus timezone.

## Verification result

Verified October 23, 2026 (Asia/Tokyo):

- `make test-go`: passed with race detector.
- `make test-integration`: passed against PostgreSQL; server suite 42.773 seconds, including the two new timezone round-trip variants.
- `make test-web`: 29 tests across 12 files passed.
- `make typecheck`: passed.
- `make build-api build-worker` and `API_URL=http://127.0.0.1:8081 make build-web`: passed.
- `make test-e2e`: 13 Chrome journeys passed in 19.3 seconds against the isolated API/database.
- `make test-operations`: passed migration/restart/restore checks on October 22; synthetic data only.
- `git diff --check`: passed.

Inspected generated screenshots for the 1024 px auth and validation screens, 1024 px dark long-title layout, 1440 px dark form, light empty report, dark monthly report and stale-edit conflict. Earlier calendar screenshots cover both desktop widths. Browser tests assert no document overflow at 1024/1440 in both themes. Images regenerate under `apps/web/test-results/`; these are local test artifacts, not deployed assets.

Local journeys and the listed operational checks pass. The traceability table explicitly distinguishes direct tests, source inspection and remaining unautomated combinations; it does not assert that every possible interaction in all 50 criteria has an independent end-to-end test.
