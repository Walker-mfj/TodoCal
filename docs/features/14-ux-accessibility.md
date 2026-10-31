# 14 — UX & Accessibility

## Purpose and scope

Document **expected interaction quality**, not assert that every checkpoint is already implemented. Current behavior includes keyboard-capable task/calendar controls, editor dialogs, toast feedback, light/dark appearance and a desktop-first UI; comprehensive mobile/accessibility certification has not been established.

## Core workflows and states

| Workflow | Required interaction / UX check |
|---|---|
| Task editing | Preserve unsaved fields on recoverable API failure; field-level validation and explicit Save/Cancel; no silent data loss |
| Task delete | Soft-delete with immediate Undo toast; distinguish toast timeout from server-side restore rights |
| Recurring delete/edit | **Current:** label the implemented options accurately (`All occurrences from today` / `Stop repeating`). **Proposed:** both Edit and Delete ask **This occurrence** vs **This and following**, anchored on the selected original slot; preview affected future tasks and warn about completed/Focus history |
| Drag/resize | Provide keyboard/form-based equivalent; show server-backed undo countdown only for the single-task schedule-undo path |
| Focus | Make start/pause/resume/end visible by keyboard and pointer; do not treat Pomodoro target as task completion |
| Connectivity | Distinguish offline, retryable uncertain mutation and actual 409 revision conflict; never show success before confirmation |
| Filtered calendar | Label progress as **Overall daily progress**; indicate when day details intentionally ignore visible filters |
| Empty days | **No plan** is not a completed score of 0%; keep an action to create a plan |
| History | Make historical/finalized status visible; explain that explicit edits can adjust the reported historical score |

## Accessibility acceptance targets

- Every action must have a keyboard path and meaningful accessible label, including calendar event quick Focus and opening the editor.
- Dialogs manage focus when opened and return it to the invoking control when closed; Escape cancels without unwanted writes.
- Live regions announce confirmed save/delete/restore/conflict without repeatedly spamming during timer ticks.
- Timer updates should not create a 250ms screen-reader announcement loop: label the timer meaningfully while throttling announcements.
- Meet usable light/dark contrast and visible focus states; icons and colors alone cannot indicate status/priority.
- Touch targets and layouts must be tested before claiming fully supported mobile PWA UX. Desktop-first 1024px+ is the current product baseline; installability alone does not imply mobile optimization.
- Reduced-motion preferences should be respected in transitions; avoid reliance on drag-and-drop as the only way to schedule.

## Regression checklist

Test: keyboard-only create/edit/delete/restore; modal focus trap/return; recurring scope confirmation; unsaved draft after 409; offline retry with same idempotency key; Undo expiry at the server; multiple Focus display instances; light/dark; long names; month-cell overflow; small viewport; and screen reader interaction for progress.

These are **QA targets**. Passing them must be verified by browser/E2E testing, not inferred from this document.
