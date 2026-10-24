# Calendar selection preview regression — October 24, 2026

A sustained drag selecting a new time range creates a synthetic FullCalendar mirror event without `extendedProps.task`. The custom event renderer assumed a persisted task and threw `Cannot read properties of undefined (reading 'status')`. A new Chrome regression test reproduced the exact page error before the fix by waiting for the mirror before releasing the pointer.

Rendering now treats task status, priority and recurrence metadata as optional. Taskless events cannot open task details, and selection/drag/resize mirrors do not receive duplicate keyboard-button behavior.

The full suite also exposed overlapping click and selection callbacks: a simple 09:00 click could have its intended 09:30 end overwritten with 09:15. Setting a five-pixel selection threshold separates a click from a drag without changing the 15-minute drag snap. The existing browser journey checks both the 09:00–09:30 click default and a 09:00–10:30 drag selection.

Validation: all 23 Chrome E2E journeys passed (40.5 seconds), including the new sustained-selection regression and existing drag/resize/Undo/keyboard/accessibility checks. The production Next.js build passed in the runner. Frontend unit tests passed (38 tests, 14 files), and typecheck passed. `git diff --check` passed. Browser runs use isolated services and the browser-test database, leaving development task data intact.
