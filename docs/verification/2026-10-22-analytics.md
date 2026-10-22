# Completion and focus analytics

Weekly/monthly reports aggregate authoritative daily plans: total completed planned occurrences divided by total planned occurrences, rather than an average of daily percentages. Valid completion events count distinct task IDs independently, including unscheduled tasks. Future dates and no-plan days do not contribute to the plan denominator.

Reports show actual focus time, completed Pomodoros, and completed-plan days. Daily details expose the matching plan, completed-task count, and focus-session contributions. Running intervals are clipped to date boundaries and the original target; pauses and breaks contribute no focus. Pomodoros belong to the finish date, including an exact-midnight finish. Focus dates consistently use the current account timezone, clearly labeled; historical task-plan snapshots retain their original timezone.

Ongoing periods compare with the same day offset and time of day in the preceding period. The cutoff day's plan is reconstructed from task events; a shorter preceding month is capped at its end. Missing preceding data is labeled. Date navigation retains a selected day within the displayed period.

## Verification

- Backend tests cover 1/1 + 0/9 = 10%, carried plans versus unique completed IDs, same-day/later reopens, independent recurring occurrences, unscheduled completion, no-plan/future exclusion, ownership, active/midnight/paused focus, exact-midnight completion, and timezone-change reconciliation.
- Comparison tests cover partial weeks, historical time-of-day, and shorter preceding months.
- Frontend tests enforce unrounded color thresholds and reserve full completion for truly completed plans.
- 29 frontend tests and TypeScript checks pass. Production web builds pass.
- Twelve production Chrome scenarios cover existing task/calendar/timer workflows and weekly/monthly metrics, day drilldown, selection, navigation, and themes. Targeted analytics rerun passes after boundary fixes.
- Light/Dark screenshots inspected. Completion rings retain 100% with a checkmark; calendar Day/Week/Month views show inline daily progress.

Final whole-branch review, performance characterization for large accounts, and operational acceptance remain Task 8. No public deployment has occurred.
