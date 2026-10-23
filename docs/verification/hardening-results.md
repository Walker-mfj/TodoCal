# Acceptance hardening — October 23, 2026

## Status

This follow-up closes concrete storage/UUID defects and expands acceptance, accessibility and load evidence. All 66 browser journeys passed across Chrome, Firefox and WebKit. Installed Safari and manual assistive-technology testing are still outstanding; this is not a full WCAG conformance certificate.

## Changes and regressions

- Optional sessionStorage now has a shared account-scoped memory fallback. Denied getters, quota failures, failed removal, account switching and exact pending-command retries have regression tests. The visible warning explains that page memory is lost on reload and denied removal can retain browser data. No saved server task depends on browser storage.
- UUID aliases are normalized before SQL. Integration tests cover URN, uppercase, braces, compact forms, malformed values and foreign-account access across reads and mutations. The original URN 500 failure was reproduced before the fix.
- Daily progress selection persists independently from the open task editor. One browser journey changes appearance while a monthly report, day selection, unsaved draft and timer coexist.
- Four overlapping calendar events are independently selectable. Browser tests exercise exact completion percentages, all five color bands, 100% checkmarks in both themes, Month untimed creation and inclusive daily/every-N-days/weekly recurrence without duplicates.
- Accessibility fixes include visible text in accessible names, calendar navigation button labels, keyboard-focusable time-grid cells after navigation, native button styling and dark timer-option contrast. Narrow viewports support enlarged desktop layouts; the inherently two-dimensional calendar scrolls locally.
- The drag test measures row pitch including collapsed borders, rather than treating cell height as grid spacing. It accounts for FullCalendar centering the subject within the hit row and lands inside the target snap instead of exactly on a rounding boundary. Three repeated Chrome drag/resize/Undo/Month runs passed after this correction. Expected API times remain unchanged.

## Accessibility scope

Axe scans WCAG 2.0/2.1 A/AA and 2.2 AA tags, without exclusions, on sign-in/registration, Settings, Groups, Tasks, Progress, Calendar, next calendar week, invalid task form, timer panel and active timer. Workspace scans run in light and dark modes. Keyboard tests register, create, validate and complete a task with real keys, without programmatic focus. macOS WebKit uses Option-Tab to include clickable controls, as described in [Apple keyboard navigation](https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac).

Reflow checks use 320/720 CSS-pixel viewports and expanded text spacing (line 1.5, letter .12em, word .16em, paragraph 2em); all primary sections must avoid document-level horizontal overflow. A 2D calendar may scroll within its own region. Desktop long-title checks cover 1024/1440 in both themes. Automated scans cannot establish screen-reader announcement quality, every keyboard path or complete WCAG conformance. VoiceOver/manual assistive-technology verification remains open.

## Load scope

See [load acceptance](load-acceptance.md) and [raw results](load-results.json). The largest account has 10,000 base tasks; the dataset includes 17,000 base tasks, 4,960 generated occurrences and 29,200 historical entries/events/focus sessions. All 2,400 mixed requests at 12-way concurrency passed; highest operation p95 was 398.3 ms and maximum 578.1 ms. Separate contention checks establish one active timer and one effect for duplicate idempotent creates. This is a bounded local synthetic measurement, not a production SLA or soak test.

## Verification

- Frontend: 38 tests across 14 files; typecheck passed.
- PostgreSQL integration suite with race detector: passed, server package 56.440 seconds.
- Production Next.js build: passed in browser runner.
- `make test-e2e`: 66/66 journeys passed without retries: Chrome 155.0.8059.86, 22/22 (40.0 seconds); Firefox 157.0, 22/22 (1.1 minutes); WebKit 27.2, 22/22 (42.9 seconds). Each project includes the full axe audit, keyboard workflow, reflow, storage failures and acceptance combinations.
- API and worker builds passed. Refreshed local API on port 8081 reports ready; localhost:3000 returns HTTP 200.
- `git diff --check`: passed.
- Inspected the generated Firefox dark editor/report screenshot at 1440 px: validation, focus outline, form controls and report layout remain visible.

The native Safari application-control attempt did not return and was interrupted. It produced no Safari test evidence. No duplicate browser suite was launched after the interruption; the completed matrix log was recovered.

## Remaining gates

1. Installed Safari 26.5.2 WebDriver refuses a session until Safari Settings → Developer → Allow remote automation is enabled. The user has been asked to enable it; no system/browser permission was changed automatically. Playwright WebKit 27.2 is a separate engine run and does not substitute for installed Safari.
2. Manual screen-reader verification is not complete. Check reading order, labels/errors, status announcements, task/calendar alternatives, timer updates and report details with VoiceOver in both themes before asserting full accessibility sign-off.

Acceptance criteria remain mapped to their executable browser/model/PostgreSQL evidence in [MVP acceptance](mvp-acceptance.md). Exact clock-boundary history and timer cases use injected backend clocks rather than production test-only clock endpoints.
