# MVP Specification — Task Management Web App with Calendar and Analytics

- Version: 2.0
- Date: October 19, 2026
- Scope: a personal productivity app for desktop web browsers.
- Basis: the scope agreed in the conversation; Pomodoro is optional.

## 1. Objective

Build an app inspired by Focus To-Do's combination of task management and focused work, with Calendar as the primary screen. Users can schedule, work on, and complete tasks, view daily completion percentages, and review weekly/monthly reports.

Primary flow: plan on the calendar → work on tasks → mark tasks complete → review progress.

**Not every task needs Pomodoro.** Users can complete the entire primary flow without opening the timer. Completing a task does not require a minimum number of focus minutes or sessions.

## 2. MVP Scope

Included:

- Create, view, edit, delete, schedule, and complete tasks.
- Calendar with Day, Week, and Month views.
- Recurring tasks: daily, every N days, or weekly, with an optional inclusive end date.
- Task lists, search, groups, priorities, and filters.
- Completion percentages based on daily plans.
- Daily, weekly, and monthly analytics with previous-period comparisons.
- Optional Pomodoro sessions, either linked to a task or run independently.
- Account registration, sign-in/sign-out, and private account-owned data.
- Go API backend and PostgreSQL persistence, accessible from multiple devices.

Excluded: mobile UI, team collaboration, sharing/assignment, offline editing/synchronization queues, external calendar integrations, subtasks, multi-day tasks, multiple time slots for a single task, AI, payments, and gamification.

## 3. Product Principles

1. Calendar supports planning; task lists support management and search.
2. Task completion is independent of Pomodoro.
3. Scheduled duration is independent of actual focus time.
4. Tasks with and without assigned times have equal weight in completion percentages.
5. Historical reports remain unchanged when tasks are later rescheduled or deleted.
6. Every drag-and-drop action has an equivalent form-based action.

## 4. Interface Structure

**Selected UI direction:** A — Clear Week, chosen on October 20, 2026. See [the design decision](../ui-demo/design-decision.md) for layout and visual requirements. Light/Dark remains independent of this layout choice.

The interface targets desktop windows at least 1024 px wide. Narrower windows may use scrolling and collapsible secondary panels; mobile optimization is outside scope.

- Left sidebar: Calendar, Tasks, Analytics, Settings, and task groups.
- Main area: the selected screen.
- Right panel: task details, opened when a task is selected.
- Top bar: a compact timer when a session is active.

The initial screen shows the current Week view. Navigating between screens does not stop an active focus session.

### 4.1. Appearance

Support explicit **Light** and **Dark** modes across Calendar, Tasks, Analytics, task details, dialogs, and Settings. The appearance switch is independent of layout selection. Default to Light on first use; persist the selected mode in account settings and restore it on reload (a local cache may prevent an initial theme flash). Changing appearance must not reset navigation, selected dates, unsaved input, task data, or timer state. Both modes require readable text, visible focus states, and distinguishable completion states without relying on color alone.

## 5. Tasks

### 5.1. Properties

| Property | Requirement |
| --- | --- |
| Title | Required; trim leading/trailing whitespace and reject empty titles |
| Description | Optional |
| Group | Optional; for example Personal, Study, or Work |
| Priority | Low, Medium, or High; default Medium |
| Scheduled date | Optional; determines which daily plan contains the task |
| Start/end times | Optional; both must be provided together and require a scheduled date |
| Deadline | Optional date and time by which the task should be completed, independent of its schedule |
| Status | Incomplete or Complete |
| Recurrence | None (default), Daily, Every N days, or Weekly |
| Recurrence interval | Required for Every N days; integer from 2 to 365 |
| Recurrence end date | Optional, inclusive, and on or after the scheduled start date |
| Estimated Pomodoros | Optional positive integer when provided; blank by default |

The end time must be after the start time on the same day. Do not infer estimated Pomodoros from scheduled duration. Do not require users to enable Pomodoro when creating a task.

### 5.2. Behavior

- Tasks can be completed with or without a schedule and with or without focus sessions.
- Tasks without a date appear in “Unscheduled”.
- Tasks with a date but no time appear in that day's “No time assigned” area.
- Do not allow a task scheduled for a future date to be marked complete directly; offer an action to move it to today and complete it.
- Completing an unscheduled task does not automatically add it to a daily plan; it still counts toward the completed-task metric for the period.
- Users can undo completion. If this happens after the day has been finalized, preserve history and update the current task status.
- Deleting a task requires confirmation. Retain finalized daily plan records and focus sessions; older sessions may reference deleted tasks.
- Groups have a name and color. Deleting a group moves its tasks to “No group” without deleting them.

### 5.3. Lists and Filters

Views: Today, Upcoming, Overdue, All, Unscheduled, and Previously Unfinished. Support title search and filters by group, priority, and status.

“Overdue” means an incomplete task whose deadline is before the current time. “Previously Unfinished” means an incomplete task scheduled for a past date, even if it has no deadline. Do not automatically move these tasks to today.

### 5.4. Recurring Tasks

The **end date** in the recurrence form means the last allowed occurrence date, not the end of a multi-day task. An individual occurrence still occupies at most one day. Label the scheduled date “Start date” when creating a recurring task.

- Does not repeat: hide recurrence interval/end controls and create one task.
- Every day: create an occurrence on each local calendar date from the start date.
- Every N days: create occurrences by adding N local calendar days from the start date; default N = 2, integer range 2–365.
- Every week: repeat on the start date's weekday, every seven local calendar days. Show the weekday in the schedule summary; multiple weekdays are outside this scope.
- End date is optional. If provided, include an occurrence on that date only when it matches the recurrence cadence. A start and end on the same date produce one occurrence.
- An end date before the start date is invalid. A repeating task requires a start date. Show a plain-English recurrence summary before saving.
- No end date means an ongoing series. Generate occurrences lazily for visible date ranges and elapsed dates needing finalization; never generate an unbounded list in memory.
- Every occurrence has its own ID and completion status. Completing, reopening, deleting, or moving one occurrence does not change other occurrences or the series cadence.
- Editing an occurrence applies to that occurrence only in the MVP, clearly labeled in the editor. Whole-series content edits and recurrence-rule changes are outside the MVP; users can stop a series and create a replacement.
- Provide “Stop repeating” for an existing series. After confirmation, omit occurrences after the current date; preserve today's occurrence and all history, including explicitly completed occurrences. Persist cancellations so removed occurrences are not regenerated.
- Each occurrence inherits the series title, group, priority, optional time range, and optional Pomodoro estimate. If the first occurrence has a deadline, later deadlines preserve its calendar-day offset from the scheduled date and local time.
- Use local calendar arithmetic across daylight-saving changes, retaining the scheduled wall-clock time. Apply the app's standard invalid/ambiguous time handling.
- Each occurrence counts independently in daily plans and completed-task counts. Moving the same occurrence across dates retains the existing carryover rules.
- Use a unique `(seriesId, originalOccurrenceDate)` key to prevent duplicate creation on reload or across tabs. Moving an occurrence does not change this identity; deletions need a persistent exception record.

## 6. Calendar

### 6.1. Views

| View | Contents |
| --- | --- |
| Day | Time axis, scheduled task blocks, an area for tasks without assigned times, and daily progress |
| Week | Seven columns from Monday to Sunday, each with progress and an area for tasks without assigned times |
| Month | Tasks and progress in each date cell; “+N tasks” when space is limited |

The toolbar includes Today, previous/next period, date selection, view switching, and group/status filters. Filters only affect visible tasks; progress still covers the entire daily plan and is labeled “Overall daily progress”.

### 6.2. Creation and Editing

| Action | Result |
| --- | --- |
| Click an empty time slot | Open a form with the date, start time, and a default duration of 30 minutes |
| Drag to select a time range | Open a form with the selected start/end times |
| Click the area for tasks without assigned times | Create a task with a date but no time |
| Click “+” in a Month cell | Create a task with a date but no time |
| Click a task | Open details to view, edit, complete, delete, or start focusing |
| Drag to another time slot/date | Reschedule while preserving duration |
| Drag the top/bottom edge in Day/Week view | Change the start/end time |
| Drag from Unscheduled into the calendar | Assign a date and time; default to 30 minutes when dropped on the time axis |
| Drag into the area for tasks without assigned times | Assign the date and clear start/end times |
| Drag to another date in Month view | Preserve existing times and duration, if any |

Drag-and-drop snaps to 15-minute increments; forms allow minute-level input. Reject time ranges that cross midnight. Invalid actions return the task to its original position and explain the error.

Valid drag-and-drop changes save immediately and show “Undo” for 10 seconds. Undo restores the schedule and affected daily plans. Rescheduling does not change the deadline or status and does not start Pomodoro automatically.

### 6.3. Presentation

- Task cards show the title, times if assigned, group color, priority, and status.
- Completed tasks appear muted with a checkmark; provide a filter to hide them.
- Overlapping tasks appear side by side, with a warning in task details; saving overlaps is allowed.
- Do not rely on color alone to communicate meaning.
- Primary actions are keyboard-accessible; buttons have labels and visible focus states.

### 6.4. Past Dates

Past calendar dates show a snapshot of the plan when the day was finalized, including the title, times, group, and completion status. Do not allow adding, dragging, or editing entries in finalized daily plans.

Users can open historical records and access the current task if it has not been deleted. Rescheduling to today or a future date only updates the current task, not the snapshot. Deleted tasks retain historical records but cannot be edited or rescheduled.

## 7. Daily Completion Percentage

**Daily completion = completed tasks in the daily plan / total tasks in the daily plan × 100%.**

Today uses current task states; past dates use finalized states. A task appears at most once in any day's plan. All tasks have equal weight regardless of priority, duration, or Pomodoro usage.

- Adding a task to today increases the denominator.
- Completing or reopening a task during the day updates the numerator.
- Deleting a task, clearing its scheduled date, or moving it away from today before finalization removes it from today's plan.
- No planned tasks: show “No plan” or “—”, not 0%.
- Future dates: show the number of planned tasks without a completion percentage.
- Display at most one decimal place. Only show 100% when every task is complete; avoid rounding an incomplete day up to 100%.

Example: 3/5 tasks = 60%; adding one task changes this to 3/6 = 50%. Tasks without Pomodoro count in full.

### 7.1. Day Finalization

A day runs from 00:00 until, but not including, 00:00 the following day in the configured time zone. The Go backend finalizes ended days before account data mutations and before returning plans or reports. A periodic worker also performs idempotent catch-up, so correctness does not depend on an open browser. Previously saved future plans must be recorded when their dates pass, even if the app was not open.

A task left incomplete on Monday, moved to Tuesday, and then completed remains incomplete in Monday's plan and complete in Tuesday's plan. These are two planned occurrences of the same task.

Changing the time zone does not reclassify finalized data. MVP task schedules use local dates/times and retain their date/time labels when the time zone changes; subsequent day boundaries use the new time zone. If the current date in the new time zone already has a finalized snapshot, keep it read-only to avoid overwriting history.

### 7.2. Calendar Display

- Day: a summary such as “3/5 tasks · 60%”.
- Week: progress at the top of each column.
- Month: a progress bar and percentage in each date cell.
- Clicking progress opens that day's analytics details.
- Explanatory text: “This percentage reflects completion of each day's plan.”

## 8. Optional Pomodoro

### 8.1. Independence from Tasks

- “Focus” is a secondary action, not a required step.
- Having no focus session does not imply that a task has not been worked on.
- Not using Pomodoro does not reduce the completion percentage.
- Finishing a Pomodoro does not automatically complete a task.
- Marking a task complete does not automatically stop the timer; users control the session independently.
- Users can run standalone sessions without linking them to tasks.

### 8.2. Timer

Defaults: 25-minute focus sessions, 5-minute short breaks, and a 15-minute long break after every four completed focus sessions. Allow durations to be customized as positive whole minutes. Active sessions retain their starting configuration; new settings apply to subsequent sessions.

Support start, pause, resume, and end early. The next session starts only when the user chooses to start it. Allow only one active timer, per account, including across tabs and devices. An existing session must be ended before another can start.

- Full duration reached: record one completed Pomodoro.
- Ended early: save actual focus time without increasing completed Pomodoros.
- Pauses/breaks: do not add to focus time.
- Reloading, switching tabs, or closing/reopening the page: calculate elapsed time from saved timestamps. An unpaused session continues until its scheduled end, without exceeding its target duration.
- Do not automatically run additional sessions while the app is closed.
- Notify/play sound when time is up if the browser permits it; notifications are not guaranteed when the browser is closed. Denying notification permission does not prevent app usage.
- Save each session exactly once using a stable ID to prevent duplicate counting after reloads or across tabs.

## 9. Analytics

### 9.1. Periods and Metrics

Weeks run Monday through Sunday; months follow the Gregorian calendar. Support period navigation and date selection.

| Metric | Formula/definition |
| --- | --- |
| Plan completion rate | Total completed planned occurrences across daily plans / total planned occurrences in the period |
| Completed tasks | Number of distinct task IDs with a valid completion event in the period, including unscheduled tasks |
| Focus time | Total actual focus seconds, displayed as hours/minutes |
| Completed Pomodoros | Number of sessions that reached their full duration |
| Days with completed plans | Number of days with every planned task complete / number of days with planned tasks |

Do not average daily percentages: if day A is 1/1 and day B is 0/9, the period rate is 1/10 = 10%.

“Planned occurrences” and “completed tasks” are separate metrics. A task carried across several days may create multiple planned occurrences but is counted only once in the completed-task metric for a given period.

A completion event undone on the same day is no longer valid. If completion is undone after the day has been finalized, preserve the historical event. Completing the task again may create another event, but the same task ID counts only once within the period being viewed.

### 9.2. Weekly/Monthly Views and Daily Drill-Down

Analytics provides explicit **Weekly** and **Monthly** controls, independent of the Calendar view selector. Both views include previous/next period navigation, a current-period action, and a visible date range.

- Weekly: display completion for each day from Monday through Sunday.
- Monthly: display daily completion in a calendar grid with weekday labels.
- Select any day to show its exact date, completed/planned counts, completion percentage, planned task list with completion states, and focus sessions if present.
- Show past dates from finalized history and today from current data. Future dates show “Upcoming” and are excluded from aggregate completion totals.
- Days without planned tasks show “No plan”; never present them as 0%.
- Daily detail selection is visible, keyboard-accessible, and remains within the displayed period when navigating periods.
- Period metrics and daily details use the same underlying records so totals reconcile.
- Tasks without Pomodoro count in all completion views; missing focus sessions do not affect completion percentages.

### 9.3. Motivating Daily Progress

Use a progress ring and completed/planned counts for each day. Full completion displays a checkmark and “Plan complete”, while retaining a visible 100% label. Selecting a day shows a short, factual encouragement based on its progress; past days must not be prompted to finish historical plans. Do not add streaks, rankings, penalties, or productivity scores.

Use consistent completion bands in Light and Dark modes:

| Completion | Color role |
| --- | --- |
| 0% | Neutral gray |
| Greater than 0% and below 50% | Amber |
| 50% to below 80% | Blue |
| 80% to below 100% | Teal |
| Exactly 100% | Green with a completion checkmark |
| No plan or future date | Neutral dashed ring, no percentage |

Show a visible legend. Always pair colors with percentages or text; colors must remain readable in both appearances. Compute bands from the unrounded completion ratio; 100% is reserved for all planned tasks complete. Week and month views use the same bands. Day details use the same ring color as the selected date.

### 9.4. Charts and Comparisons

- Daily completion chart with a 0–100% axis.
- Daily focus-minutes chart, separate from task completion.
- Monthly calendar showing completion rates and dates with no plan.
- Day details: plan, task states, focus sessions, and daily metrics.
- Compare completion rates in percentage points; compare focus time using the difference in hours/minutes.
- An ongoing period includes data only up to the current time, excluding future dates.
- Compare an ongoing period against the same number of days and time of day in the preceding period. If the preceding month is shorter, use its end and clearly label the comparison range.
- No preceding-period data: show “Not enough data to compare”.

Sessions crossing midnight split focus time between dates, excluding paused intervals. Count the Pomodoro on the date the session finishes. Active-session time is reflected up to the current time without double counting when the session ends.

Users who do not use Pomodoro still receive full task analytics. The focus section shows “No focus sessions yet” rather than implying zero productivity.

## 10. Data and Functional Structure

**Architecture:** Next.js App Router + TypeScript/React frontend, a separate Go REST API, and PostgreSQL as the source of truth. Selected on October 20, 2026. Next.js renders the interface; all authentication, authorization, task mutations, recurrence generation, daily finalization, timer state, and analytics rules belong to Go. The browser never connects directly to PostgreSQL.

### 10.1. Minimum Data Model

| Entity | Data |
| --- | --- |
| User | ID, normalized email, password hash, creation timestamp |
| AuthSession | Hashed opaque session token, user ID, expiration and revocation timestamps |
| Task | User ID, ID, nullable series ID and original occurrence date, title, description, group, priority, scheduled date/times, deadline, status, nullable estimated Pomodoros, creation/update/deletion timestamps |
| TaskEvent | ID, task ID, event type, timestamp, local date, and time zone; records scheduling and completion history |
| DailyPlanEntry | Date, task ID, schedule information for that date, finalized status; unique by date + task ID |
| DailySnapshot | Date, time zone, planned/completed occurrence counts, finalization timestamp |
| FocusSession | ID, nullable task ID, target duration, status, start/end timestamps, running/paused intervals, actual duration |
| RecurrenceSeries | ID, task defaults, start date, cadence, interval days, optional inclusive end date, optional stopped-after date |
| RecurrenceException | Series ID, original occurrence date, occurrence ID, cancellation/override state |
| Group | ID, name, color |
| Settings | Time zone, Pomodoro/break durations, sound, appearance (`light` or `dark`); notification permission is read per browser |

All account-owned records carry `user_id`. Enforce ownership in every query and relation, including groups, tasks, recurrence, snapshots, focus sessions, and settings. Use UUID identifiers, PostgreSQL `date`/`time` for local schedules, and `timestamptz` for instants. API instants use RFC 3339 UTC strings.

### 10.2. Responsibilities

- Task management: validate and persist task actions and generate events.
- Calendar: render schedules and translate user interactions into task updates.
- Daily planning: manage plan membership and finalize history.
- Timer: manage session state without deciding task status.
- Analytics: calculate metrics from plans, completion events, and focus sessions.
- Storage: PostgreSQL with versioned SQL migrations; update related records in one server-side transaction.
- Authentication: Go owns credentials and revocable server-side sessions.
- Frontend: Next.js calls the Go API and displays acknowledged server state; it does not duplicate domain decisions.

Data belongs to the signed-in account and persists independently of browser storage. Clearing site data logs the user out but does not delete server data. The same account can access its tasks and history on another device. IndexedDB/Dexie is not used as the primary database. This supersedes the earlier browser-only design; the disposable UI demo still uses sample in-memory data.

### 10.3. Accounts and Sessions

- MVP authentication uses email/password registration, sign-in, sign-out, and password change while signed in. Email verification, third-party sign-in, and email-based password recovery are outside the initial implementation scope.
- Store only salted Argon2id password hashes. Use generic authentication errors and rate-limit authentication attempts.
- Use opaque, expiring server-side sessions with HttpOnly, Secure (production HTTPS), SameSite cookies. Never store authentication tokens in localStorage.
- Protect state-changing requests against CSRF. Clear cached account data on logout or account switch. Password changes revoke other sessions.
- All data endpoints require authentication and ownership validation; guessing another account's resource ID must not reveal or modify it.

### 10.4. API, Synchronization, and Connection Behavior

- Expose versioned REST JSON endpoints under `/api/v1`; use one public origin routing `/api/*` to Go and web pages to Next.js.
- PostgreSQL is authoritative. Refresh cached views after successful writes, on window focus/reconnection, and every 15 seconds while visible. Other devices converge after refresh or the next successful poll; immediate real-time push is not required.
- Each mutable record has a revision. Stale updates receive a conflict response, preserve the user's input, and offer reload/reapply rather than silently overwriting newer data.
- Use idempotency keys for retried mutations; timeout/retry must not create duplicate tasks, occurrences, or sessions.
- Show connection status. Offline users may inspect already-loaded data, but writes and timer controls require a server acknowledgment; preserve unsaved drafts and never show a failed write as saved.
- Existing running timers continue to elapse while disconnected. The display is provisional until reconnection; focus time is derived from server timestamps and capped at the target duration.
- One active timer per account is enforced transactionally in PostgreSQL. A second device sees the existing timer; concurrent starts cannot create two sessions.
- Use server time for events and day finalization. Account time zone determines local day boundaries. Day finalization and recurring occurrence creation remain idempotent across API instances and workers.
- Keep health/readiness endpoints, structured logs without secrets, and database migrations. Local development uses Docker Compose for PostgreSQL; a production hosting provider is not selected by this spec.

## 11. Errors and Consistency

- Show form errors beside the relevant fields and preserve user input.
- Do not report success when saving fails; revert drag-and-drop changes and allow retries.
- Empty states provide guidance for creating tasks without fabricated metrics.
- Multiple tabs/devices: refresh from the API after successful writes and on focus/reconnection; reject stale revisions with a conflict. One active timer is enforced per account in PostgreSQL.
- Day finalization, session creation, and session-end processing must be safe to repeat.
- On app load, finalize past days before accepting new actions to protect historical data.

## 12. Acceptance Criteria

### Tasks and Calendar

1. The initial screen shows the current Week view.
2. A task with only a title and no Pomodoro can be created and marked complete.
3. Clicking 09:00 opens a 09:00–09:30 form; dragging 09:00–10:30 selects that exact range.
4. Creating a task in the area without assigned times or in Month view does not automatically assign a time.
5. Dragging a task to another date updates Calendar, task lists, and daily plans.
6. Resizing a task changes only its scheduled duration, not Pomodoro data.
7. Overlapping tasks remain visible and individually selectable.
8. Undoing drag-and-drop restores the schedule and affected metrics.
9. Finalized daily plans cannot be edited; rescheduling preserves history.
10. Reloading preserves task and calendar data.

### Progress and Analytics

11. With five tasks today, completing three without Pomodoro produces 60%.
12. Adding one task changes this to 50%; reopening one completed task then displays 33.3%.
13. Tasks with and without assigned times both count toward the daily plan.
14. No planned tasks displays “No plan”; future dates show only task counts.
15. Moving a task from a finalized day to today does not change the earlier day's rate.
16. Day A at 1/1 and day B at 0/9 produce a period rate of 10%.
17. Calendar filters do not change overall daily progress.
18. Completing an unscheduled task increases completed tasks without changing the daily plan denominator.
19. Deleting a task does not remove finalized plan records.
20. Reopening the app after several days correctly finalizes previously saved plans.
21. Period totals match daily details; future dates are excluded from an ongoing period.

### Optional Pomodoro

22. Tasks can be saved, scheduled, and completed without estimated Pomodoros.
23. A 25-minute target session ended at minute 10 records 10 focus minutes and zero completed Pomodoros.
24. Reaching the target duration increases completed Pomodoros without completing the task automatically.
25. Running a standalone session does not create a task or change completion percentages.
26. Breaks and paused time do not count toward focus time.
27. Reloading or opening multiple tabs does not create extra timers or duplicate session records.
28. A session crossing midnight allocates focus minutes to the correct dates and counts the Pomodoro on its end date.
29. Denying notifications still allows timer and task-management usage.

### Analytics Navigation and Appearance

30. Switching Weekly/Monthly shows the correct date range and all dates in that period; previous/next and current-period actions work.
31. Selecting a day shows matching counts, task completion states, and optional focus sessions; the period aggregate reconciles with daily details.
32. Selecting a day without a plan shows “No plan”; future dates show “Upcoming” and do not affect totals.
33. Light/Dark works across all screens and dialogs, independently of layout, and persists after reload.
34. Changing appearance preserves the current report period, selected day, unsaved task input, and timer state.

35. Daily progress uses consistent gray/amber/blue/teal/green bands at 0%, greater than 0%, 50%, 80%, and exactly 100%, including in Light/Dark modes and day details.
36. Full completion shows a checkmark and 100%; no-plan/future dates use a dashed neutral state. A visible legend and text make progress understandable without color.

### Recurrence

37. Creation offers Does not repeat, Every day, Every N days, and Every week; the summary reflects the selected cadence and optional end date.
38. Starting October 19 with an October 25 inclusive end produces seven daily occurrences, four occurrences every two days (19, 21, 23, 25), or one weekly occurrence (19).
39. A weekly series starting October 19 and ending November 2 produces October 19, October 26, and November 2. End dates before start and invalid intervals are rejected.
40. Completing one occurrence leaves the others incomplete; deleting/rescheduling an occurrence does not regenerate its original slot or shift later occurrences.
41. Reloading, opening another tab, or catching up after several closed days never duplicates occurrences. Historical daily plans correctly include due recurring occurrences.
42. Stop repeating preserves current/past records and prevents future generation; a series without an end date generates only the requested finite range.

### Backend, Accounts, and Cross-Device Data

43. Registration, sign-in, sign-out, session expiration, and password change work; protected APIs reject unauthenticated requests.
44. Account A cannot read or modify account B’s tasks, groups, recurrence, reports, settings, or focus sessions by substituting IDs.
45. Signing into the same account on another device retrieves persisted data. Clearing browser storage does not delete tasks or history.
46. Retrying a timed-out mutation with the same idempotency key creates no duplicate effect. Failed transactions leave task, event, and plan state consistent.
47. Concurrent stale edits return a conflict; input is preserved and the newer server edit is not silently overwritten.
48. Concurrent timer starts from separate devices produce exactly one active session; finishing a session twice records one completion.
49. Recurrence and day finalization catch up correctly after worker downtime or closed browsers, without duplicate occurrences or snapshots.
50. Offline writes are not reported as saved; reconnecting refreshes authoritative data and active timer state. Light/Dark preference follows account settings.

## 13. MVP Completion Conditions

The create → schedule → work → complete → review analytics flows function consistently on desktop web browsers. Data persists after reopening the browser, and all acceptance criteria above are verified. Users who do not use Pomodoro can still complete the full task-management flow and track completion percentages.
