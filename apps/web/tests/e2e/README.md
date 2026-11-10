# E2E journeys

Use one test per coherent user journey, with `test.step()` for meaningful phases. A failed step stops the rest of that journey; steps do not provide isolation. Keep independently useful failure modes in separate tests.

## Coverage map

| Original coverage                                                                                          | Owner after refactor                | Decision                                                                                          |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Calendar priority: 2 widths × 2 card sizes                                                                 | `calendarPriorityLayout.spec.tsx`   | One test, four named steps; load component once                                                   |
| Dialog: 2 themes × 2 widths                                                                                | `dialogLayout.spec.tsx`             | One test, four named steps; load components once                                                  |
| Calendar range selection, validation, immediate saves, off-week creation; create preview from draftPreview | `calendar.spec.ts` creation journey | Select → validate → preview → save → recurring save → off-week save                               |
| Draft editing, discard, slot retargeting                                                                   | `draftPreview.spec.ts`              | Independent API seed; verify saved identity and unsaved data                                      |
| Past-month creation in toast; historical completion/edit/report in taskUx                                  | `taskUx.spec.ts` historical journey | UI creation → completion → edit → daily report                                                    |
| Criteria progress transitions and analytics navigation/theme                                               | `analytics.spec.ts`                 | Shared dataset; 66.7%, 60%, 50%, 33.3%; unscheduled completion; weekly/monthly/day reconciliation |
| Dialog dirty/clean close, keyboard focus trap, backdrop, axe                                               | `dialog.spec.ts`                    | Keep independent: accessibility failure should not hide edit-persistence coverage                 |
| Focus custom duration/task selection/break                                                                 | `focusScene.spec.ts`                | Named phases for one custom-duration journey                                                      |
| Focus default duration, completion independence, second device                                             | `focus.spec.ts`                     | Keep independent of custom duration; these assert different behavior                              |
| All completion bands, cross-device appearance, recurrence                                                  | `criteria.spec.ts`                  | Keep independent datasets and regression boundaries                                               |

Calendar drag/resize, uncertain retries, recurrence scopes, notification denial, authentication/session expiry, storage failures and Web Push remain independent. The broad acceptance/accessibility suites exercise keyboard and cross-workspace behavior; they are not folded into feature journeys.

## Fixtures and isolation

Import `test` and `expect` from `./fixtures` for authenticated feature tests. The fixture registers a unique account through the UI for every test, retry and browser project, using Playwright's isolated page/context. It does not share storage state or a mutable account across tests. `account` exposes credentials for a second device within the same test. `auth` exposes `today` in the account timezone and `send(path, body, method?)` with Origin, CSRF and a fresh idempotency key.

Use raw `@playwright/test` when exercising logged-out authentication, pre-navigation storage failures or static layout markup. These suites deliberately retain their own setup. Do not use `auth.send` for retry-identity assertions: those tests must capture and replay the original command/key.

Use `calendarHelpers.ts` for single-slot selection. Keep range/drag/resize gestures explicit where they are the behavior under test. Save screenshots with `test.info().outputPath(...)` to separate browsers and retries.

## Running and interpreting results

From the repository root:

```sh
sh scripts/testE2e.sh
```

This starts the isolated test database and production servers, then runs Chromium, Firefox and WebKit separately, resetting test rate-limit counters between projects. Target a journey with:

```sh
sh scripts/testE2e.sh --project=chromium calendar.spec.ts --grep 'task creation journey'
```

Static layout tests need no backend:

```sh
cd apps/web
npx playwright test calendarPriorityLayout dialogLayout
```

This refactor removes 11 test cases per browser. The original checkout discovered 52 → 41 cases (156 → 123 runs); current main adds independent cross-tab Focus and offline-draft regressions, both preserved in this PR (54 → 43 cases, 162 → 129 runs). This is a reduction in setup/repeated journeys, not a measured runtime improvement. The PR preserves main’s 30-second timeout and single worker. The initial local validation used the older checkout’s Chrome project and 45-second timeout; CI must validate the merged configuration. Measure CI duration and failures on all three browsers before deciding whether any combined journey needs splitting.

Local verification on 2026-11-10: typecheck and discovery succeeded. Browser layout attempts failed at browser launch before assertions; Docker socket access was denied, preventing backend E2E execution. Full browser validation remains pending in an environment that can launch browsers and Docker.

## Adding a new test

1. Find the feature owner in the coverage map. Add a step to an existing journey only when it uses the same account/data and naturally follows the preceding action. Use a separate test for an independent outcome, failure injection, or different setup.
2. Name the test for observable behavior, and name each step for a user action and its expected result. Avoid growing a journey merely to reduce the number of `test()` calls.
3. Use the authenticated fixture for normal feature flows. Seed prerequisite data with `auth.send`; perform the action being tested through the UI. Do not seed through the API if creation itself is the behavior under test.
4. Prefer roles and accessible names for interactions. Use semantic CSS hooks only for calendar geometry or visual states that have no suitable accessible locator.
5. Wait for observable UI or API state with Playwright assertions or `expect.poll`. Do not use fixed sleeps. Assert identity/count when testing updates so accidental duplication is caught.
6. Keep test-owned state inside the test or test-scoped fixture. Close additional browser contexts in `finally`; never depend on another test's execution order.
7. Run the targeted journey on all three browsers, then the complete suite. Update the coverage map when moving responsibility between files. A browser-specific skip needs a concrete unsupported capability and an explanation.

### File responsibilities

| File                 | Responsibility                                                       |
| -------------------- | -------------------------------------------------------------------- |
| `<feature>.spec.ts`  | User journeys and behavior assertions for that feature               |
| `*Layout.spec.tsx`   | Static component markup and real-browser layout assertions           |
| `fixtures.ts`        | Per-test authentication, credentials and authenticated seed requests |
| `calendarHelpers.ts` | Shared Calendar slot interaction; no hidden data setup               |
| `layoutStyles.ts`    | Loading production components and styles for layout tests            |

Keep assertions visible in the journey. Extract a helper when multiple tests need the same interaction; avoid generic wrappers around individual `click` or `fill` calls. New files should follow existing camelCase names and use `.spec.ts` (or `.spec.tsx` when rendering JSX).

### Authenticated journey template

This example seeds a prerequisite task, edits it through the UI, and confirms that the same task was updated:

```ts
import { test, expect } from "./fixtures";

test("editing a task preserves its identity", async ({ page, auth }) => {
  const task = await test.step("Seed a scheduled task", async () => {
    return auth.send("/tasks", {
      title: "Original title",
      scheduledDate: auth.today,
      startTime: "10:00",
      endTime: "11:00",
    });
  });

  await test.step("Edit the title through Calendar", async () => {
    await page.reload();
    await page
      .locator(".fc-event")
      .filter({ hasText: "Original title" })
      .click();
    await page.getByRole("button", { name: "Edit task", exact: true }).click();
    await page.getByLabel("Task title").fill("Updated title");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByLabel("Task title")).toBeHidden();
    await expect(
      page.locator(".fc-event").filter({ hasText: "Updated title" }),
    ).toBeVisible();
  });

  await test.step("Verify persistence without creating a duplicate", async () => {
    const response = await page.request.get("/api/v1/tasks");
    expect(response.ok()).toBeTruthy();
    const { items } = await response.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: task.id, title: "Updated title" });
  });
});
```

This is a structural example, not an additional regression to copy into the suite unchanged: edit persistence is already covered in `draftPreview.spec.ts`.

### Review checklist

- Does the new assertion cover a distinct behavior rather than duplicate an existing journey?
- Can this test run alone, in any order, and on retry with a fresh account?
- Do named steps make the failing phase clear without hiding assertions in helpers?
- Are error paths and accessibility checks independent when they need different setup?
- Are screenshots written through `test.info().outputPath(...)`?
- Do formatting, lint, typecheck and discovery pass, and are browser results reported accurately?
- If the journey exceeds its budget, can it be split at an independent behavior boundary before changing timeouts?

Run the current main quality checks from `apps/web` before opening a PR:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run check:architecture
npx playwright test --list
```

Current main uses oxfmt/oxlint. Use `npm run format` for formatting instead of introducing another formatter configuration. Local checks from an older checkout do not certify these newer commands; CI must run the current toolchain.
