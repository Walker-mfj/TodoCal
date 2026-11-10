# Post-deploy smoke checks

These checks complement browser CI. A simulated Push event or successful subscription API response does not prove delivery through a real push provider.

## Evidence for this follow-up

- PR #20 merged as `e2fc4cb529c00d4e329e4825e2fbf7cd900aa8fa` after all seven PR checks passed.
- The frontend deployment [run 42782768311](https://github.com/Walker-mfj/TodoCal/actions/runs/42782768311) failed in the Settings sound-preview unit test before deployment. The test clicked before draft hydration enabled its fieldset. This follow-up waits for readiness and verifies that playback actually created oscillators before checking their cancellation.
- Production manual checks below are **pending**, not passed. Re-running deployment requires approval; the attempted rerun was rejected by automatic approval review. Confirm the deployed frontend and API revisions before recording results.

## Preparation

Use a dedicated test account and a real browser profile on the deployed HTTPS site. Record date, frontend/API revisions, URL, browser/OS versions and account identifier (never passwords, tokens or raw push endpoints). Confirm the notification worker is running, provider configuration is present, system/site notifications are allowed and quiet hours do not cover the test window.

## Real Web Push delivery

1. Open Settings, enable notifications on this device through the browser's real permission prompt, and enable scheduled task reminders. Save and confirm the device remains enrolled after reopening Settings.
2. Create a uniquely named scheduled task far enough ahead to allow enrollment and delivery, taking the configured reminder lead time into account. Record the expected reminder time and timezone.
3. Close all TodoCal tabs while leaving the browser running. Wait through the due window. Do not inject a Push event, mock PushManager, or substitute a local timer notification.
4. Observe the OS notification with the task's title. Record actual receipt time; click it and verify TodoCal opens the intended task for the correct account. Correlate a worker delivery result if available; provider acceptance alone is not proof of OS receipt.
5. Revoke this device in Settings. Schedule a second uniquely named task and verify no notification arrives after the due window while other notification permissions remain unchanged. Remove test tasks and sign out when finished.

Record PASS only with observed real delivery and correct click routing. Record BLOCKED for unavailable provider configuration, worker, permissions or devices; record FAIL for missing/incorrect delivery after checking those prerequisites.

## Draft recovery after lost connectivity

1. Sign in, open New task and enter a unique title and notes. Disable the device network connection, then edit the draft again. Confirm Save is disabled and text remains visible.
2. Reconnect, reload the same tab, reopen New task and verify the latest draft fields are restored. The app is not required to load a fresh page while offline.
3. Save once. Verify exactly one task appears, reload and confirm New task is empty. Repeat with a request interrupted during Save: reconnect and use Retry save, confirming no duplicate task.
4. Drafts use session storage; closing the entire tab/session is outside this reload-persistence check. Do not clear site data between steps.

## Focus across tabs

1. Open two tabs in the same browser profile/account. Start a Focus session in tab A; confirm tab B shows the same running session without reloading.
2. Pause from B and confirm both tabs show Paused with the same frozen time. Resume from A and confirm B runs again; no second session should appear.
3. Background A for at least a minute, return to it, and compare its timer to B and the elapsed wall time. Verify it catches up rather than restarting from a stale anchor.
4. End from B and verify both tabs become idle without reload. Confirm the recorded session/history is singular. Also check expiry while one tab is hidden; record any duplicated OS notification separately from timer-state correctness.

## Result record

| Flow | Revision / browser / OS | Observed result | Evidence |
|---|---|---|---|
| Real Push with all app tabs closed; click routing; revoke | Pending deploy | NOT RUN | — |
| Offline draft restoration and uncertain save retry | Pending deploy | NOT RUN | — |
| Multi-tab Focus including background elapsed time | Pending deploy | NOT RUN | — |

Automated coverage in this follow-up adds offline draft restoration after reconnect/reload and same-profile multi-tab Focus start/pause/resume/end. It does not replace the production observations above.
