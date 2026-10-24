# Live calendar drafts and dialog refinement

## Changes

- Shared confirmations have a clearer header/action layout, context icon, top-right close button and backdrop dismissal in light/dark themes. X, backdrop and Escape cancel; they never approve the pending action. Keyboard focus remains contained and returns to the trigger.
- Calendar previews show the editor's current title/date/time with a dashed outline and Draft badge, without API writes or progress changes. Invalid schedules do not produce invalid FullCalendar events. Closing removes the preview and restores saved events; reopening restores the retained draft.
- Selecting a calendar slot while editing preserves the existing task identity and content, changing only its schedule. Pending commands remain protected.
- Preview publication is limited to the Calendar page, avoiding unnecessary workspace updates while typing on other pages.

## Verification

- `make test-web typecheck`: 43 unit tests passed; TypeScript passed.
- `bash scripts/test-e2e.sh --project=chrome`: 26/26 passed (47.1 seconds), including production build, existing drag/resize/drop/undo, recurrence, conflicts, storage denial, keyboard flows and automated accessibility checks.
- Additional strengthened draft test: 1/1 Chrome passed, including sequential keyboard entry of a 300-character title while previewing, close/restore, no implicit API writes and task identity after slot selection.
- Shared dialog light/dark screenshots and calendar draft screenshot visually inspected. Dialog accessibility audits passed in both themes.
- `git diff --check`: passed.

The first full run exposed stale drag-test coordinates after preview scrolling; the test now re-reads the calendar geometry. The long-title keyboard flow also exposed unnecessary preview publication outside Calendar; restricting publication resolved it, with an exact input-value assertion added to the regression test. The final full run passed, and the expanded calendar typing test passed separately.

All browser tests use the isolated `focus_web_test` database. Chrome remains the required browser target. No backend/schema changes were needed.
