# PR #58 review — remaining P2 findings

Reviewed commit: `243a9bd8ff95ac477b9ec5da80f30690386733d6`. [Pull request #58](https://github.com/Walker-mfj/TodoCal/pull/58).

## P2 — Focus timer CSS also targets the loading spinner

Sources: [timerClock.module.css:10–16](https://github.com/Walker-mfj/TodoCal/blob/243a9bd8ff95ac477b9ec5da80f30690386733d6/apps/web/src/features/focus/components/timerPanel/timerClock.module.css#L10-L16), [timerClock.tsx:37–47](https://github.com/Walker-mfj/TodoCal/blob/243a9bd8ff95ac477b9ec5da80f30690386733d6/apps/web/src/features/focus/components/timerPanel/timerClock.tsx#L37-L47).

The `.focus-clock svg` selector applies the progress ring's absolute positioning, inset and rotation to every descendant SVG, including the Lucide SVG rendered by LoadingIndicator.

When the timer reaches zero and settlement is fetching, the spinner is positioned at the edge of the clock rather than inline beside “Confirming completion…”.

**Required fix:** scope the progress-ring CSS to its own SVG (e.g. `.focus-clock > svg` or a dedicated class). Scope circle styles to the ring as well. Preserve spinner size, inline positioning, animation and reduced-motion behavior.

**Regression check:** render a timer at zero with settlementPending=true; verify the indicator is inline next to the confirmation label and the progress ring retains its geometry. Verify failure and offline states do not display the spinner.

## P2 — Group save loses its pending indicator when Cancel clears editing

Source: [groups.tsx:208–242](https://github.com/Walker-mfj/TodoCal/blob/243a9bd8ff95ac477b9ec5da80f30690386733d6/apps/web/src/features/tasks/components/groups/groups.tsx#L208-L242).

The save button derives its pending state from `actions.isPending(\`PATCH:/groups/\${editing?.id}\`)`. Cancel remains enabled during the save, and clearing editing changes the key while the original PATCH is still in flight.

Reproduction:
1. Edit group A.
2. Click Save group with the request delayed.
3. Click Cancel before the request settles.
4. The spinner and aria-busy disappear despite the pending PATCH.

**Required fix:** disable Cancel while command.busy, or retain the initiating action identity independently of the editable draft. Do not change command retry/idempotency semantics.

**Regression check:** hold the save promise open and verify Cancel cannot remove the pending feedback. Confirm it clears on success or failure.

## P2 — Workspace command retry lacks persistent pending feedback

Sources: [homePage.tsx:426–453](https://github.com/Walker-mfj/TodoCal/blob/243a9bd8ff95ac477b9ec5da80f30690386733d6/apps/web/src/home/components/homePage/homePage.tsx#L426-L453), [useCommand.ts:44–47](https://github.com/Walker-mfj/TodoCal/blob/243a9bd8ff95ac477b9ec5da80f30690386733d6/apps/web/src/shared/hooks/useCommand.ts#L44-L47).

The workspace's generic Retry request button is disabled while busy but does not use LoadingIndicator. Additionally, the enclosing toast is rendered only when message or command.error is present. Starting a retry clears command.error immediately, so the toast may disappear before the request finishes.

**Required fix:** track the initiating retry through usePendingAction, keep a visible pending status while that promise is running, and use the shared LoadingIndicator with appropriate aria-busy. Preserve the existing retry payload/idempotency key and disabled logic. Resolve or replace the status when the retry succeeds or fails; avoid indefinite animation for uncertain commands awaiting manual retry.

**Regression check:** simulate an ambiguous command failure with no separate message, delay the retry response, and verify pending feedback persists until settlement. Cover both success and failure.

## Validation

At the reviewed commit, all five GitHub Actions jobs passed ([run #45564725387](https://github.com/Walker-mfj/TodoCal/actions/runs/45564725387)), including Chromium E2E. These findings are based on source/diff inspection; physical layout measurements and Firefox/WebKit visual checks were not independently performed.
