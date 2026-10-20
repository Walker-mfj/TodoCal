# Approved UI Direction — Clear Week

- Decision date: October 20, 2026
- Selected by the user: **A — Clear Week**.
- Scope: desktop web UI direction for the MVP.
- Product requirements: [MVP specification](../specs/2026-10-19-focus-calendar-mvp.md).
- Implementation plan: [Focus Calendar MVP](../superpowers/plans/2026-10-19-focus-calendar-mvp.md).

## Layout

Use the Clear Week layout: persistent left navigation, a spacious central calendar, and a right-hand task details panel. Calendar Week is the initial view. At narrower desktop widths, details may open on demand so the calendar remains usable. Analytics uses the main content area without the task details sidebar.

Use a restrained sans-serif type system, subtle borders, compact controls, and ample separation between navigation, daily progress, and calendar content. Use the base tokens in `tokens.css` and the `data-mode=dark` overrides. Do not use Quiet Planner's serif typography/agenda layout or Focus Desk's denser layout.

## Approved Refinements to Carry Forward

- Light and Dark appearance, independently selectable and persisted.
- Weekly/monthly completion reports and daily task drill-down.
- Daily progress rings, completed/planned counts, factual encouragement, and a checkmark at full completion.
- Completion colors: gray at 0%, amber above 0% and below 50%, blue from 50% to below 80%, teal from 80% to below 100%, and green at 100%.
- A visible legend and textual values; neutral dashed states for no-plan/future dates.
- Creation with optional daily/every-N-days/weekly recurrence and an inclusive recurrence end date.
- Independent completion for each occurrence.
- Pomodoro remains optional and secondary to task management.

## Production Boundaries

The prototype is a visual reference, not production code or a completed application. Its fixed sample dates, in-memory tasks, preview recurrence limits, and placeholder timer do not carry into the product. Implement and verify the business rules and acceptance criteria in the spec.

All UI text and project artifacts remain in English. Conversation with the user remains in Vietnamese.

The user's choice approves the visual direction; implementation execution-method selection remains separate.
