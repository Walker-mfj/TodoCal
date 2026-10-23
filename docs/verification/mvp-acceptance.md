# MVP acceptance and operations

Scope: Clear Week desktop web MVP on Next.js, Go and PostgreSQL. Local acceptance is separate from public deployment. Chat remains Vietnamese; application copy and project documentation are English.

## Evidence index

- `apps/web/tests/e2e/workspace.spec.ts`: account isolation after session loss, second browser persistence, task/recurrence/group flows, stale revisions, offline/reconnect, light/dark, calendar click/selection.
- `apps/web/tests/e2e/calendar.spec.ts`: drag, resize, Undo, external scheduling, uncertain retry, immediate new-task visibility, custom inline validation.
- `apps/web/tests/e2e/focus.spec.ts`: independent optional timer, reload/multiple browsers, denied notifications, retry without duplicate sessions.
- `apps/web/tests/e2e/analytics.spec.ts`: weighted totals, distinct completions, daily drilldown, week/month navigation and theme.
- `apps/web/tests/e2e/acceptance.spec.ts`: keyboard-only registration/create/complete, custom invalid-field focus, 300-character titles, empty states, 1024/1440 layouts in both themes. Theme selection is a separate layout check using a native select; this is not an exhaustive keyboard or screen-reader audit.
- `apps/web/tests/e2e/criteria.spec.ts`: exact 60% → 50% → 33.3% transitions, unscheduled denominator independence, four selectable overlapping events, untimed Month creation, simultaneous theme/report/day/draft/timer retention, completion color thresholds and inclusive recurrence generation.
- `apps/web/tests/e2e/storage.spec.ts`: denied storage and quota failure with exact retry after a lost response, settings, timer and logout.
- `apps/web/tests/e2e/accessibility.spec.ts`: axe WCAG A/AA audits in both themes plus narrow viewport/text-spacing checks. See the hardening report for scope and outstanding manual checks.
- `scripts/test-load.py`: isolated load and concurrency correctness gates; results in `load-acceptance.md` and `load-results.json`.
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
| 7 | Criteria browser journey opens each of four overlapping events; layout disables event overlap. |
| 9, 15, 19, 20 | `TestDailyHistoryCarryoverAndProgress`, `TestDelayedCatchupAndTimezoneSnapshotProtection`, `TestTimezoneForwardPreservesExistingDayPlan`. |
| 11, 12, 13 | Criteria browser journey checks exact 60% → 50% → 33.3% after completion, addition and reopening; planning and progress-model tests cover mixed timed/untimed plans. |
| 14, 32 | No-plan/future model tests, analytics browser checks and empty-state screenshots. |
| 16, 18, 21 | `TestPeriodWeightedPlansDistinctEventsAndReopen` checks weighted 1/10, unscheduled completions and future exclusion. |
| 17 | Workspace browser journey changes filters while overall progress stays unchanged. |
| 23, 24, 25, 26 | `TestFocusElapsedPauseCatchupAndIndependence`; focus browser journey verifies task/timer independence. |
| 27, 48 | `TestFocusConcurrentDevicesOwnershipAndRevisions`, focus browser reload/multiple-device journey. |
| 28 | `TestAnalyticsFocusMidnightPausesAndActiveReconciliation`, `TestAnalyticsPomodoroAtExactMidnightBelongsToNewDay`. |
| 29 | Notification-denial browser journey. |
| 30, 31 | Analytics browser journey; aggregate/day integration tests, including focus reconciliation. |
| 33 | Workspace second-browser theme persistence and acceptance screenshots at both widths/themes. |
| 34 | Criteria browser journey changes appearance while a monthly report, selected day, unsaved task draft and active timer coexist, then verifies all four survive. |
| 35, 36 | Criteria browser journey verifies all five bands and 100% checkmark in both themes; exact-ratio model tests cover boundaries, no-plan and future states. |
| 37, 38, 39 | `TestRecurrenceCadenceAndInclusiveEnd`, `TestRecurrenceValidationDeadlineAndIndependentCompletion`; criteria browser journey creates daily/every-two-days/weekly series through the form and verifies 7/4/1 inclusive occurrences and no duplicates after reload. |
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

- The expanded browser targets are Chrome, Firefox and Playwright WebKit. The user subsequently limited required browser acceptance to Chrome; installed Safari is no longer required. WebKit is not reported as Safari. Full screen-reader/manual WCAG conformance is not certified.
- Denied/full sessionStorage falls back to page memory with a visible warning. Memory cannot survive reload; blocked storage deletion can leave browser data until storage access is restored. Saved server data remains authoritative.
- Accepted UUID aliases are normalized before SQL; malformed IDs and cross-account aliases have regression coverage.
- Weekly recurrence summary does not spell out its weekday; the start date remains visible.
- The documented synthetic large-account workload passes its latency/correctness gates. Auth/receipt pruning, trusted proxy policy and public deployment hardening remain operational follow-ups.
- Email verification, forgotten-password recovery, offline write queues, push notifications with the app closed and background automatic breaks are outside this MVP.
- Notifications require explicit browser permission. Denial does not block task or timer flows. Sound/background delivery depends on browser permissions and throttling.
- Focus days use the current account timezone; historical task plans retain their saved timezone. Day details label the focus timezone.

## Original Task 8 verification result

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

## October 23 hardening follow-up

See [hardening results](hardening-results.md) for the current test matrix, fixes and remaining Safari/manual accessibility gates. Original Task 8 counts above are retained as historical evidence, not the expanded suite totals.
