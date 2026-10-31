# 15 — Cross-feature Acceptance Scenarios

## Status

This is a **test contract and proposed regression checklist**, not a claim that all scenarios already pass. “Current contract” describes what the current code intends to do. “Future design” identifies behavior requiring implementation before acceptance.

## Tasks, history, and analytics — current contract

1. **Soft delete and restore:** Given a task with revision R, deleting returns the next revision and removes it from normal lists; after the 10-second toast disappears, a restore API request with the correct latest revision is still accepted (no server restore deadline today).
2. **Historical adjustment:** Given a finalized day 3/5, explicitly backdating a completion/edit updates that day and recalculates the week/month summary; another task's captured entry is not silently rewritten.
3. **Group removal:** Given a finalized day with a colored group, deleting that group does not change the captured historical group name/color or the day's planned/completed counts; live tasks lose their group.
4. **No plan vs zero progress:** Given zero planned tasks, return percentage `null` / display **No plan**; given five planned and zero completed, display **0%**.
5. **Weighted rollup:** Given day A 1/1 and day B 0/9, display 10% for the combined period.
6. **Unscheduled completion:** Completing an unscheduled task increments the completed-task metric but does not add a daily-plan denominator.

## Recurrence — current contract

7. **Stable slot:** Re-reading the same range, moving an occurrence, or soft-deleting it never creates a duplicate original slot.
8. **Single occurrence:** Editing one occurrence preserves its series association; siblings remain unchanged. Moving it records a `moved` exception for the original slot.
9. **All scope:** Selecting an occurrence in the future then choosing “All occurrences” updates eligible occurrences from **today** and the series template, not exclusively those after the selected date; previous history is unchanged.
10. **Stop and restore:** Stop soft-deletes incomplete future occurrences, preserves today's/past and completed future records, and rejects restore atomically after a relevant task revision changes.
11. **DST:** A future invalid local time creates a recomputable `invalid_local_time` exception; explicit delete/move exceptions do not resurrect after timezone changes.

## Focus, concurrency and monitoring — current contract

12. **Focus source of truth:** A 25-minute target stopped after ten minutes records ten minutes/zero Pomodoros; completion at target counts one; the linked task remains incomplete.
13. **Late-mounted clocks:** Opening a second timer display after a minute must show approximately the same remaining time as the first, not restart the full target.
14. **Server-confirmed finish:** Completing on a subsequent `GET /focus` reconciles the state; dependent task/calendar/report queries are invalidated after confirmation.
15. **Retry:** Two same-key/same-content mutation attempts produce one business change and the same saved response; same key with different content returns `409 idempotency_conflict`.
16. **Revision conflict:** A stale `expectedRevision` is rejected with 409 and the caller can retain/reapply a draft.
17. **Schedule undo:** A single-task move can be undone only within the server's 10-second token deadline if no later revision intervened; the client clock cannot extend it.
18. **Monitoring:** Multiple concurrent reporters cannot exceed the shared 1000-events/day budget; raw error messages and secret tokens are not sent.

## Proposed/future acceptance — not yet implemented

19. **Scheduled reminder:** With an installed and subscribed PWA, a reminder for a scheduled task fires through Web Push while the website tab is closed, subject to OS/network delivery limits.
20. **Durable Focus completion:** A backend worker settles elapsed Focus sessions without any client request and schedules a completion notification idempotently.
21. **Notification controls:** Per-device subscription revocation, permission denial, quiet hours and changed/deleted tasks behave predictably without emitting duplicate or private-content-bearing notifications.
22. **Edit recurring — This and following (proposed):** Selecting an occurrence dated 15 Nov edits its slot and later slots, not slots from today through 14 Nov. Split the series at the selected **original occurrence slot**; preserve IDs, moved/deleted exceptions, completed future records and Focus history. This behavior is **not currently supported**.
23. **Delete recurring — This and following (proposed):** Selecting the original 15 Nov slot removes that slot and all following slots from active scheduling, including any already materialized future occurrences, without deleting Focus sessions or rewriting finalized history. Re-materializing the date range never brings them back. The delete scope, concurrency and undo handling are **not currently supported**.
24. **Immutable baseline view:** If required, original finalized metrics remain inspectable alongside adjusted metrics and an audit reason. Only adjusted snapshots + event journal exist today.
25. **Offline editing:** If adopted, multi-device offline mutation replay must resolve revisions and account identity without duplicating writes. This feature is outside the current scope.

## Running this checklist

For each scenario, write a Go service/integration or web component/E2E test as appropriate, with frozen account-local dates/timezones where timing matters. Run in CI before marking the scenario “verified.” Avoid asserting that a proposed scenario already passes.
