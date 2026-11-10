# 12 — PWA & Notifications

## Implementation and deployment status

The manifest supports installation where offered by the browser. Installation alone does not enable notifications. Settings now provides explicit device opt-in, four event toggles, a reminder lead of 0–1440 minutes, quiet hours in the account timezone, and device revocation. Browser permission is requested only after **Enable on this device**. Denial or unsupported browsers leave task and Focus features usable.

The Go API stores preferences, session-bound subscriptions and a durable delivery outbox. The service worker handles push and safe same-origin navigation; it does not cache private API responses or queue offline writes. VAPID configuration and a recurring scheduler must be enabled before background delivery is available. Repository tests use a fake push provider; real provider delivery and closed-app behavior on supported devices still require deployment verification. No live deployment is claimed by this PR.

## Events

| Event | Behavior |
|---|---|
| Scheduled task | Optional lead reminder and start reminder; never starts a Focus session |
| Deadline | Reminder at deadline minus configured lead |
| Focus completion | Worker first persists completion, then queues notification |
| Break completion | Optional reminder; the user starts the next session explicitly |

All toggles default off. Lead zero avoids a separate duplicate task lead reminder. Quiet hours support midnight crossings and suppress events rather than saving a quiet-hour backlog. Payloads contain generic text, a stable replacement tag and a calendar/Focus destination, never task titles or account credentials. Opening a notification navigates after authentication; it performs no task or timer mutation.

## Delivery contract

- Each active subscribed device gets its own durable outbox record. Delivery is independent of both access and refresh expiry, including legacy sessions. Inactivity does not expire device enrollment; signing in again is required to use the app after refresh expiry, but reminders continue. Logout, session-family revocation, device revocation and an expired provider endpoint stop delivery. A successful login on the same browser preserves that account’s existing consent; switching accounts revokes the previous account’s subscriptions on that browser. Logout/revoked consent is not restored.
- The scheduler settles expired Focus sessions and materializes recurring tasks through two future local dates, with additional ranges for deadlines before scheduled dates, so reminders do not depend on visiting the calendar, including short DST days.
- Before every attempt the worker checks the current task/session, schedule, preferences, timezone, subscription and quiet hours. Deleted or rescheduled events are canceled.
- Due candidates are bounded to the last 24 hours. Transient failures retry up to six attempts with exponential minute delays. HTTP 404/410 revokes the stale endpoint. Other permanent provider failures stop retries.
- Delivery is at least once across a process crash after provider acceptance but before database commit. Stable notification tags replace duplicates on a device; exact-once OS display is not promised.
- Browser, OS, network and hosting cold starts can delay or suppress notification delivery. Local foreground completion notifications remain available independently and may coincide with Web Push if both are enabled.
- DST gaps are rejected by schedule validation and excluded from notification candidates. Ambiguous wall times choose the earlier valid instant, matching recurring deadline resolution.

## API and operations

`GET /notifications` returns preferences, active devices and the public VAPID key (empty when not configured). `PUT /notifications/preferences` uses `expectedRevision`; conflicts retain the UI draft. `POST /notifications/subscriptions` associates the browser endpoint with the current account/session. `DELETE /notifications/subscriptions/{id}` revokes an owned device. Mutations use the existing Origin, CSRF and idempotency command pipeline. Endpoints and private keys are never returned in device lists.

Subscriptions accept supported Chrome, Firefox and Safari push hosts only. Sending uses HTTPS, validated public destination addresses, bounded timeouts and no redirects. See [deployment configuration](../../deploy/README.md) for scheduler and VAPID setup.

Before enabling production reminders, verify permission grant/denial, two devices, closed-tab delivery, offline recovery, logout, schedule/timezone changes and provider-expired subscriptions. iOS Home Screen behavior requires verification on the actual supported device. Automated coverage is recorded in the [acceptance matrix](15-acceptance-scenarios.md).


## Automated browser coverage and live verification boundary

Run `sh scripts/testE2e.sh tests/e2e/webPush.spec.ts --project=chromium`. The runner creates an ephemeral test-only VAPID identity; no production credentials or real provider delivery are used. This file is included in the normal Chromium CI job. Firefox/WebKit explicitly skip it because incoming Push injection uses Chromium DevTools; their delivery behavior is not certified by this test.

Three browser journeys exercise the actual UI, authenticated API, isolated database and shipped service worker:

1. Explicit device opt-in, persisted preferences/quiet hours after reload, and revocation. No subscription or service worker is created just by visiting Settings.
2. Denied browser permission leaves subscriptions empty and task creation usable.
3. Close the TodoCal tab (keep the browser running), inject a Push through DevTools and inspect the browser's actual notification store. Repeat the tag to verify replacement. Execute the shipped notification-click handler, open its requested destination, and verify Focus appears without starting a session.

Test boundaries are deliberate: `PushManager.subscribe/getSubscription` return a valid synthetic provider subscription; DevTools supplies incoming Push instead of FCM/APNs/Mozilla; a synthetic click captures `clients.openWindow` because it has no OS user activation, then Playwright opens that URL. No notification HTTP API responses or production service-worker handlers are mocked. The test does not run the scheduler/outbox-to-provider leg, inspect an OS banner, close the whole browser process, or verify an installed iOS app. Those paths retain backend integration coverage and require live release verification.

For a live check, use a dedicated test account/device on the deployed HTTPS app: enable the device and Focus reminders, complete a short session after closing the app tab, correlate the scheduled-job/outbox result with the received device notification, then tap it and confirm Focus opens without starting another timer. Repeat with the preference off and after device revocation, and record browser/OS, deployment revision, timestamps and results without recording subscription endpoints or credentials. A successful local E2E run must not mark this live check complete.

The unified Settings screen identifies the current enrollment by both server ownership and the SHA-256 fingerprint of the browser's existing push endpoint. It does not request permission or enroll during inspection. An enabled device shows its browser/OS label and Revoke; permission loss or a missing local subscription shows an off state. Server enrollment is refreshed on return to the page and cross-tab workspace events without replacing preference drafts.
