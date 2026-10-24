# Calendar editor and shared confirmations — October 24, 2026

The workspace previously confirmed every transition from an open editor, even when pristine. The editor itself used title presence rather than changes as its close guard. New calendar seeds were ignored after mount, so choosing another time did not update an existing draft.

The editor now compares normalized field values against a persisted baseline. Clean forms are not saved as drafts; reverting edited fields restores a clean state. Calendar selection during new-task creation updates only the schedule, preserving other input without a confirmation. A pending/in-flight save cannot be retargeted; retries preserve the original request identity. Closing edited drafts and switching away use the same keep-draft confirmation.

A shared styled HTML dialog replaces all browser confirmations across draft close/discard/reload, future-task completion, sign-out, task/group deletion and recurrence stop. It uses safe initial focus, explicit Tab/Shift-Tab wrapping, Escape cancellation, trigger focus restoration, labeled content and Light/Dark tokens. Inline validation/error messages remain inline. An active decision cannot be replaced by another request.

Evidence:

- Added seed-change regression; it failed with the original 09:00 value instead of 11:00 before the fix.
- 41 frontend unit tests across 14 files passed, including description-only edits/reversion and unchanged uncertain-command retries after a slot change. Typecheck passed.
- Chrome full suite: 25/25 passed, 43.8 seconds. New journeys verify clean close, draft content retention across calendar slots, dirty-close cancellation/confirmation/restoration, focus boundaries/Escape, group deletion cancellation/confirmation and no browser dialogs.
- Shared dialogs passed axe A/AA audits in Light/Dark; both generated screenshots were visually inspected. The initial keyboard regression exposed focus escaping to browser chrome and passed after explicit boundary wrapping.
- Production Next.js build and TypeScript validation passed in the browser runner. `git diff --check` passed. The browser database/services are isolated from development data.

Design and behavior details: `docs/superpowers/specs/2026-10-24-calendar-editor-dialogs.md`.
