# 13 — Settings & Personalization

## Purpose

Centralize account-level preferences and their effects on planning, recurrence, Focus and display.

## Current data and behavior

`settings` stores explicit IANA `timezone` (default UTC when no explicit value is provided), `appearance` (light/dark), default Focus/short-break/long-break durations, `sound`, and optimistic `revision`.

- `PATCH /settings` requires `expectedRevision`; a stale revision returns 409 and should preserve the user's unsaved draft for review.
- The API rejects missing/invalid IANA time zones and unknown appearance values. The UI currently constrains Focus to 1–180 minutes and breaks to 1–60 minutes; task-specific Focus duration is a separate 1–180 minute setting. The API enforces the same settings bounds. Starting a timer also validates the resolved default, rejecting out-of-range values saved by older versions; a valid explicit session override remains usable. Explicit session overrides retain their separate 1–180 minute contract.
- Appearance changes should persist across reloads/devices without resetting drafts, navigation, running sessions, or task data.
- A time-zone change calls `BeforeZoneChange` to seal dates crossed by a forward time-zone jump. Existing finalized plans retain their saved timezone; future local-date calculation uses the new zone. Future invalid-wall-time recurrence exceptions may be reevaluated.
- A changed default Focus duration should affect **new** sessions, not mutate elapsed time, targets, or past sessions already persisted.
- The Notifications panel controls **Web Push** only. Its explanation distinguishes open-tab completion notifications (controlled by browser permission), warns that both paths can notify for the same completion, and explains how to block site notifications in browser settings. **Timer sound** remains independent. The Focus panel repeats this distinction; this clarification does not change delivery behavior.
- Notification permissions are **device/browser local**. A separate `notification_preferences` record stores account event toggles, lead time and quiet hours; Settings also lists and revokes session-bound device subscriptions.

## Product rules and edge cases

- Display the time zone as an explicit IANA identifier (for example, Asia/Tokyo). Never silently replace it with the browser's zone.
- Warn that changing timezone can alter what counts as “today,” due dates, which calendar day owns a completion, and when new recurring occurrences appear. Confirm before a change that may seal days.
- Handle daylight-saving gaps/overlaps when creating timed tasks or recurrence; avoid time arithmetic using fixed 24-hour-day assumptions.
- Show a clear response to a 409 (`Reload / Reapply local draft`). Never silently overwrite remote changes from another device.
- If the user logs out or switches accounts, discard or isolate per-account settings caches and unsaved drafts.

## Future options


- Clearly named accessibility preferences beyond light/dark mode (e.g., reduced motion or a denser calendar) if product research supports them.

## Acceptance

1. A stale settings revision fails without losing draft input.
2. Saving appearance updates UI and survives a reload.
3. Changing timezone preserves historical snapshot timezone while applying new local-day boundaries to future planning.
4. Modifying default Focus minutes never changes an already running session.
5. Browser notification denial does not break Settings or Focus.

Related: [auth](01-accounts-auth.md), [recurrence](06-recurrence.md), [finalization](07-planning-finalization.md), [PWA](12-pwa-notifications.md).
