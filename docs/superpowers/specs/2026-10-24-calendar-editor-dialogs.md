# Calendar draft behavior and shared confirmations

The requested interaction keeps task content while selecting a new calendar slot and asks for a decision only when leaving an edited draft. The existing Clear Week visual system and light/dark tokens remain the design basis.

## Behavior

- Compare the editor's current values with its initial baseline, normalizing empty/default values. A title alone is not a dirty-state proxy: description, dates, group, priority, recurrence and other edits matter. Reverting to the baseline is clean.
- Selecting another calendar slot while creating a task updates scheduled date/start/end only. Keep title, description, group, priority, deadline, recurrence and Pomodoro input. Fresh slot selection is initialization, not a reason to interrupt the user with a close confirmation.
- A clean editor closes immediately. Closing an edited editor shows “Close editor?” with “Keep editing” and “Close editor”. Confirming keeps the draft, consistently with the existing workspace-switch message. Restored drafts retain their baseline; pristine forms are not persisted as drafts.
- An uncertain/in-flight save keeps its exact original command. Calendar slot changes must not modify or silently replace that pending command; the user sees a message to confirm the save first.

## Shared dialog

Use a styled native HTML dialog in the modal top layer, controlled through an asynchronous shared confirmation API. This keeps browser-provided inert background behavior while allowing application styling. Explicit Tab/Shift-Tab boundary wrapping prevents focus escaping to browser chrome. A full bespoke modal implementation adds unnecessary focus-management complexity; browser confirm cannot meet the requested visual consistency.

Dialogs use Clear Week panel, text, border and overlay tokens, including Light/Dark. Each decision has a title, explanation, explicit cancel/action labels and a red action only for destructive decisions. Focus starts on the safe cancel choice, Escape cancels, and focus returns to the trigger. Background clicks do not approve the action. Repeated requests cannot replace an unanswered decision. Unmount cancels a pending decision.

All existing browser confirmations move to this API: closing/switching edited drafts, discarding/reloading drafts, sign-out with drafts, future-task completion, deleting tasks/groups and stopping recurrence. Inline validation and error notices remain inline; they are already application-rendered and do not require modal interruptions.

## Verification plan

1. Reproduce unchanged schedule when the editor seed changes; add unit coverage for content retention, description-only changes/reversion and uncertain-request identity.
2. Browser coverage: clean close, slot retargeting with content retained, dirty close/cancel/restore, real keyboard focus containment and Escape, and group deletion cancel/confirm in both themes.
3. Axe audit the shared dialog in both themes; inspect generated screenshots. Run Chrome acceptance, frontend unit tests, typecheck and production build. Update old tests to interact with the app dialog rather than auto-accept browser dialogs.
