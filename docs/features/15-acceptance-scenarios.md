# 15 — Cross-feature Acceptance Scenarios

## Status

This is the acceptance contract for the implementation branch. Implementation, test coverage, and production deployment are separate milestones. The matrix below records available coverage and remaining checks; a test file alone is not evidence that a release is verified.

## Tasks, history, and analytics — current contract

1. **Soft delete and restore:** Given a task with revision R, deleting returns the next revision and removes it from normal lists; after the 10-second toast disappears, a restore API request with the correct latest revision is still accepted (no server restore deadline today).
2. **Historical adjustment:** Given a finalized day 3/5, explicitly backdating a completion/edit updates that day and recalculates the week/month summary; another task's captured entry is not silently rewritten.
3. **Group removal, journaling and recovery:** Given a finalized day with a colored group, deleting that group does not change the captured historical group name/color or the day's planned/completed counts. All referencing task rows, **including soft-deleted tasks**, have `group_id = NULL` and their revision incremented. Only **non-deleted** affected tasks receive a new `group_cleared` event; soft-deleted affected tasks **do not** receive that event. Restoring a previously soft-deleted task requires its latest revision, keeps the group unset and records the regular `restored` event.
4. **No plan vs zero progress:** Given zero planned tasks, return percentage `null` / display **No plan**; given five planned and zero completed, display **0%**.
5. **Weighted rollup:** Given day A 1/1 and day B 0/9, display 10% for the combined period.
6. **Unscheduled completion:** Completing an unscheduled task increments the completed-task metric but does not add a daily-plan denominator.

## Recurrence — current contract

7. **Stable slot:** Re-reading the same range, moving an occurrence, or soft-deleting it never creates a duplicate original slot.
8. **Single occurrence:** Editing one occurrence preserves its series association; siblings remain unchanged. Moving it records a `moved` exception for the original slot.
9. **Legacy all-scope API:** An older client selecting an occurrence in the future then sending `scope: all` updates eligible occurrences from **today** and the series template, not exclusively those after the selected date; previous history is unchanged.
10. **Legacy stop and restore API:** Stop soft-deletes incomplete future occurrences, preserves today's/past and completed future records, and rejects restore atomically after a relevant task revision changes.
11. **DST:** A future invalid local time creates a recomputable `invalid_local_time` exception; explicit delete/move exceptions do not resurrect after timezone changes.

## Focus, concurrency and monitoring — current contract

12. **Focus source of truth:** A 25-minute target stopped after ten minutes records ten minutes/zero Pomodoros; completion at target counts one; the linked task remains incomplete.
13. **Late-mounted clocks:** Opening a second timer display after a minute must show approximately the same remaining time as the first, not restart the full target.
14. **Server-confirmed finish:** Completing on a subsequent `GET /focus` reconciles the state; dependent task/calendar/report queries are invalidated after confirmation.
15. **Retry:** Two same-key/same-content mutation attempts produce one business change and the same saved response; same key with different content returns `409 idempotency_conflict`.
16. **Revision conflict:** A stale `expectedRevision` is rejected with 409 and the caller can retain/reapply a draft.
17. **Schedule undo:** A single-task move can be undone only within the server's 10-second token deadline if no later revision intervened; the client clock cannot extend it.
18. **Monitoring:** Multiple concurrent reporters cannot exceed the shared 1000-events/day budget; raw error messages and secret tokens are not sent.

## Newly implemented acceptance — release verification pending

19. **Scheduled reminder:** With an installed and subscribed PWA, a reminder for a scheduled task fires through Web Push while the website tab is closed, subject to OS/network delivery limits.
20. **Durable Focus completion:** A backend worker settles elapsed Focus sessions without any client request and schedules a completion notification idempotently.
21. **Notification controls:** Per-device subscription revocation, permission denial, quiet hours and changed/deleted tasks behave predictably without emitting duplicate or private-content-bearing notifications.
22. **Edit recurring — This and following:** Selecting an occurrence dated 15 Nov edits its slot and later slots, not slots from today through 14 Nov. Split the series at the selected **original occurrence slot**; preserve IDs, moved/deleted exceptions, completed future records and Focus history. The new UI sends an explicit following scope; legacy all-scope API semantics are retained.
23. **Delete recurring — This and following:** Selecting the original 15 Nov slot removes that slot and all following slots from active scheduling, including any already materialized future occurrences, without deleting Focus sessions or rewriting finalized history. Re-materializing the date range never brings them back. Warn and require confirmation before including completed future tasks. Undo restores the tail atomically only if relevant revisions still match.
## Excluded or deferred

24. **Immutable baseline view — excluded (2026-11-01):** No separate original-baseline view will be implemented in this scope. Retain adjusted snapshots and the event journal; this is not an acceptance requirement.
25. **Offline editing:** If adopted, multi-device offline mutation replay must resolve revisions and account identity without duplicating writes. This feature is outside the current scope.

## Coverage and verification matrix — 2026-11-01

Paths in the table are relative to `apps/api/internal` for Go tests and `apps/web` for web tests. **Covered** means the named test exercises the core contract; the final integrated runs and CI results remain the release gate. It does not imply that every edge case or live deployment is verified.

| ID | Contract / level | Existing tests | Remaining assertion or release check | Status |
|---|---|---|---|---|
| 1 | Current; API + browser | `controllers/taskUx_test.go::TestHistoricalAdjustmentDeleteRestoreAndCompletionDate`; `tests/e2e/taskUx.spec.ts` restore | Explicit API restore after the UI toast's ten seconds is not a separate timed regression | Core covered; deadline distinction tracked |
| 2 | Current; API + browser | `controllers/taskUx_test.go`; `controllers/analytics_test.go`; historical task E2E | Full combined release run | Covered |
| 3 | Current; API | `controllers/planning_test.go::TestSeriesOwnershipRangeAndGroupHistory` | Dedicated soft-deleted group member revision/journal/restore assertion still absent | Partial coverage |
| 4 | Current; API + browser | `controllers/planning_test.go::TestDailyHistoryCarryoverAndProgress`; `tests/e2e/criteria.spec.ts`; `acceptance.spec.ts` | Full browser run | Covered |
| 5 | Current; API | `controllers/analytics_test.go::TestPeriodWeightedPlansDistinctEventsAndReopen` | Combined release run | Covered |
| 6 | Current; API + browser | Same weighted-period test; `tests/e2e/criteria.spec.ts` independent unscheduled completion | Combined release run | Covered |
| 7 | Current; API | `controllers/planning_test.go::TestLazyRecurrenceExceptionsAndStop`; `controllers/recurrenceFollowing_test.go` | Combined release run | Covered |
| 8 | Current; API + browser | `controllers/planning_test.go::TestEditRecurringTaskScope`; `tests/e2e/calendar.spec.ts` scope journey | Combined release run | Covered |
| 9 | Legacy API; API | `controllers/planning_test.go::TestEditRecurringTaskScope`, `TestSeriesEditPreservesHistoryAndRollsBackInvalidShift` | Retain backward compatibility when deploying new UI | Covered |
| 10 | Legacy API; API | `controllers/taskUx_test.go::TestRecurringStopUndoAndOccurrenceRestore` | New UI uses following-delete; legacy endpoint remains separately tested | Covered |
| 11 | Current; API + date unit | `controllers/planning_test.go` DST gap/timezone tests; `localdate/date_test.go` | `TestFollowingReevaluatesPredictedInvalidTimes` covers a split across a DST gap | Core covered; new combination tracked |
| 12 | Current; API + browser | `controllers/focus_test.go::TestFocusElapsedPauseCatchupAndIndependence`; `tests/e2e/focus.spec.ts` | Full browser persistence journey | Covered |
| 13 | Current; hook + browser | `src/features/focus/hooks/useRemaining.test.tsx`; `tests/e2e/focus.spec.ts` | Combined release run | Covered |
| 14 | Current; API + hook | `controllers/analytics_test.go::TestAnalyticsFocusMidnightPausesAndActiveReconciliation`; Focus hook tests | Explicit automatic browser report refresh at natural completion remains a separate check | Partial UI coverage |
| 15 | Current; API + browser | `controllers/tasks_test.go::TestConcurrentTaskCommandsSerializeAndReplay`; focus idempotency test; `tests/e2e/focus.spec.ts`, `storage.spec.ts` | Full uncertain-response browser run | Covered |
| 16 | Current; API + browser | task/focus concurrency tests; `tests/e2e/home.spec.ts` conflict draft journey | Combined release run | Covered |
| 17 | Current; API + browser | `controllers/schedule_test.go` expiry/conflict/ownership tests; `tests/e2e/calendar.spec.ts` Undo | Combined release run | Covered |
| 18 | Current; concurrency + transport | `controllers/monitoring_test.go`; `monitoring/monitoring_test.go` | No browser suite required for server budget | Covered |
| 19 | New; service + browser + live delivery | `services/notifications_integration_test.go::TestNotificationDeliveryLifecycle`; notification browser utilities | Configure deployed VAPID/scheduler; verify actual provider and installed-device delivery while closed | Local implementation; live verification pending |
| 20 | New; worker/API + service | `controllers/focusWorker_test.go`; notification lifecycle test | Deployed scheduled invocation, catch-up and operational logs | Local implementation; deployment pending |
| 21 | New; service + component | notification lifecycle/quiet-hours unit tests; `src/features/notifications/components/notificationSettings.test.tsx`; `utils/browserPush.test.ts` | Real browser permission/subscription, logout/revocation and OS constraints | Local implementation; live verification pending |
| 22 | New; API + component + browser | `controllers/recurrenceFollowing_test.go` split, cadence, moved-cutoff, protected-history tests; recurrence UI and calendar scope tests | Final cross-browser run | Implemented; release verification pending |
| 23 | New; API + browser | Same file's atomic delete/restore and conflicting-Undo tests; `tests/e2e/home.spec.ts` following-delete journey | Final integrated browser run | Implemented; release verification pending |
| 24 | Excluded | None required | No immutable-baseline feature in this PR | Excluded |
| 25 | Deferred | None required | No offline mutation replay in this PR | Deferred |

## Running this checklist

`make test-integration` provisions separate controller and notification test databases; `scripts/testE2e.sh` uses a third browser-only database and fixed local ports. CI runs the API integration suite and one browser job per Chrome, Firefox and WebKit, retaining failure traces and server logs. No blind retries or disabled accessibility rules are used.

Final local browser verification: **Chrome 46/46, Firefox 46/46 and WebKit 46/46 passed** (138 total), including both-theme axe audits, keyboard focus, recurring deletion/Undo and uncertain retries. Web unit/component tests: **96/96**. The API race-enabled integration suite and seven edge/service-worker tests also passed. CI repeats these checks on the PR; a local pass is not a claim that hosted CI has completed. Production VAPID, scheduled delivery, and real closed-browser notifications remain unverified.
