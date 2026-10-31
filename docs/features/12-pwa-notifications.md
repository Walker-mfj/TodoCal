# 12 — PWA & Notifications

## Purpose and release status

Explain how TodoCal can be installed as a web app and how reminders/notifications should behave. **Do not confuse browser Notification API, installable PWA metadata, and Web Push.**

## Current implementation

- `apps/web/src/app/manifest.ts` provides a web manifest: name, start URL, standalone display, theme/background colors and two PNG icon sizes. A browser may offer **Install app** / **Add to Home Screen** depending on platform and browser behavior.
- The current Focus UI requests browser notification permission after a user action and may call `new Notification(...)` when a client **observes** an active session complete. Sound also requires browser audio permission/activation.
- There is **no documented production Push API subscription endpoint, VAPID key handling, service-worker push handler, or background notification scheduler** in the reviewed implementation. Installing TodoCal **does not** itself enable Web Push or offline task editing.
- The Focus timer is server-authoritative. Notification delivery is a UI signal, not the source of truth for elapsed time, Pomodoro counts, or task status.

## Proposed — scheduled reminders and reliable background notifications

| Event | Proposed behavior | Notes |
|---|---|---|
| Scheduled task / focus time approaches | Optional reminder (for example, 5 minutes before), then at start | A scheduled task is **not** an automatically started Focus session |
| Focus session reaches target | Completion notification and link to the active task/session | Worker must first make completion idempotent and persistent |
| Break ends | Optional start-next-session reminder | Do not auto-start another timer without user consent |
| Task deadline approaches | Configurable deadline reminder | Deadline is independent of scheduled calendar time |

Proposed architecture:

1. Register a **service worker** and request notification permission only following a meaningful user gesture; no repeated permission prompts after denial.
2. Subscribe each browser/device to Push API, store the endpoint and keys under the authenticated user, and allow users to list/revoke device subscriptions. Rotate/expire stale subscriptions and avoid logging secrets.
3. The Go API stores reminder preferences and subscription metadata in PostgreSQL; a bounded worker schedules due notifications using durable identifiers, idempotent delivery attempts, and account-local timezone semantics.
4. Use VAPID Web Push to send generic, privacy-safe payloads (avoid placing confidential task titles in notification text by default). A push click navigates to the appropriate TodoCal screen after authentication.
5. Respect quiet hours, per-event toggles, duplicate suppression, logout and disabled/expired subscriptions. Do not claim exact-second delivery: browser/OS/network may delay or suppress pushes.

**iOS note:** Web Push support for compatible Home Screen web apps depends on platform version, installation and permission. Behavior differs by browser/OS; confirm on supported devices rather than assuming native-equivalent execution.

## Constraints and acceptance

- A closed tab must **not** be described as receiving dependable notifications until Web Push infrastructure is implemented and verified.
- Denying notification permission must never prevent task creation, Focus usage, or calendar navigation.
- A notification is never an authoritative task/Focus mutation; tapping **Start focus** must still invoke a server command.
- Test permission granted/denied, two subscribed devices, offline device, deleted/changed task, time-zone change, DST transition, quiet hours, and duplicate worker retries before shipping background reminders.
- Offline **read caching** and offline **write queues** are separate future decisions; do not introduce a service worker that caches private API responses without user isolation and invalidation rules.

See [Focus](08-pomodoro-focus.md) and [settings](13-settings.md).
