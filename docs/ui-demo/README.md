# Desktop UI Direction Preview

Open `index.html` through a local HTTP server. This is a disposable UI prototype, not the production application.

## Directions

- **A — Clear Week:** cool light palette, broad weekly calendar, persistent task details.
- **B — Quiet Planner:** warm paper palette, serif headings, daily agenda beside the calendar, details on demand.
- **C — Focus Desk:** compact navigation and denser workspace.

## Interactive Preview

Switch directions, open Calendar/Tasks/Analytics, switch Week/Month, select a task, complete/reopen it, and add/edit a sample task. Daily progress updates from sample tasks. Task completion does not require Pomodoro.

The sample date is October 19, 2026. Analytics shows a separately labeled sample week (October 12–18); no real user metrics are represented. Edits are in memory and reset on reload. The optional focus control previews placement and does not start a real timer. Dragging, resizing, storage, full date navigation, and production business rules are not implemented. The preview time axis covers 09:00–15:00.

## Reports and Appearance

Analytics supports Weekly/Monthly views, previous/next/current periods, and selecting a day to inspect its planned task statuses. Period totals and day details are derived from the same dated sample records. Today uses the current demo task list. Future dates are excluded and empty days show “No plan”. Focus sessions remain optional.

Light/Dark is independent of A/B/C layouts and applies across the preview, including dialogs. Only the appearance preference is saved in localStorage; sample task edits still reset on reload.

## Selection Gate

Select a direction or combine specific elements. Review the calendar, task editor, task details, and analytics before locking design tokens and beginning application implementation. Mobile UI is explicitly outside scope.

## Daily Completion Presentation

Week and month reports use progress rings and the same completion palette: gray at 0%, amber below 50%, blue below 80%, teal below 100%, and green at full completion. Completed days show a checkmark and 100%. No-plan/future days remain neutral and dashed. The legend, explicit counts, and day-detail encouragement make progress understandable without relying on color. No streaks or penalties are introduced.

## Recurrence Preview

New-task creation offers Does not repeat, Every day, Every N days (2–365), and Every week on the start date's weekday. The optional end date is inclusive. The preview creates independent in-memory occurrences; completing one does not complete the others. Editing affects only the selected occurrence.

Without an end date, this disposable preview generates 28 calendar days; explicit end dates are limited to 366 occurrences. These are preview limits only: production uses lazy range generation for open-ended series. Use Tasks to inspect occurrences outside the fixed preview calendar week/month. Stop-series management is specified for production but is not implemented in this UI preview.
