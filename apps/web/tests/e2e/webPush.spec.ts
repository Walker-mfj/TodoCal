import { test, expect, type Page } from "@playwright/test";
import { createECDH, randomBytes, randomUUID } from "node:crypto";

// Real UI/API/database/service worker. Only provider enrollment and incoming
// push transport are simulated. This does not certify production/OS delivery.
test.beforeEach(async ({ browserName }) => {
  test.skip(
    browserName !== "chromium",
    "Push injection uses Chromium DevTools.",
  );
});

async function account(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`push-${randomUUID()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Push-testing-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Notifications", exact: true }),
  ).toBeVisible();
}

async function fakeProvider(page: Page) {
  const key = createECDH("prime256v1");
  key.generateKeys();
  const subscription = {
    endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${randomUUID()}`,
    keys: {
      p256dh: key.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
  await page.addInitScript((value) => {
    Object.defineProperty(PushManager.prototype, "getSubscription", {
      value: async () => null,
    });
    Object.defineProperty(PushManager.prototype, "subscribe", {
      value: async () => ({ toJSON: () => value }),
    });
  }, subscription);
}

test("Web Push device opt-in persists preferences and supports revocation", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["notifications"]);
  await fakeProvider(page);
  await account(page);
  const before = await (await page.request.get("/api/v1/notifications")).json();
  expect(before.publicKey).not.toBe("");
  expect(before.subscriptions).toHaveLength(0);
  expect(context.serviceWorkers()).toHaveLength(0);
  await expect(page.getByLabel("Focus session completed")).not.toBeChecked();
  await page.getByRole("button", { name: "Enable on this device" }).click();
  await expect(
    page.getByText(
      "Notifications enabled for this device. Choose your reminder types below.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Revoke notification device 1" }),
  ).toBeVisible();
  expect(context.serviceWorkers()).toHaveLength(1);
  await page.getByLabel("Focus session completed").check();
  await page.getByLabel("Quiet hours start").fill("22:00");
  await page.getByLabel("Quiet hours end").fill("07:00");
  await page
    .getByRole("button", { name: "Save notification preferences" })
    .click();
  await expect(page.getByText("Notification preferences saved.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Focus session completed")).toBeChecked();
  await expect(page.getByLabel("Quiet hours start")).toHaveValue("22:00");
  await page
    .getByRole("button", { name: "Revoke notification device 1" })
    .click();
  await expect(page.getByText("No devices enabled.")).toBeVisible();
  const after = await (await page.request.get("/api/v1/notifications")).json();
  expect(after.subscriptions).toHaveLength(0);
});

test("Web Push permission denial never enrolls a device or blocks task creation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "denied" });
  });
  await account(page);
  await page.getByRole("button", { name: "Enable on this device" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Notifications are blocked" }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/v1/notifications")).json())
      .subscriptions,
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Task title").fill("Works without Push");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByLabel("Task title")).toBeHidden();
  expect(
    (await (await page.request.get("/api/v1/tasks")).json()).items.some(
      (task: { title: string }) => task.title === "Works without Push",
    ),
  ).toBe(true);
});

test("real service worker displays injected Push after the app tab closes and routes a click", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["notifications"]);
  await fakeProvider(page);
  await account(page);
  const origin = new URL(page.url()).origin;
  // Keep DevTools alive on an unrelated blank tab, not an active TodoCal client.
  const control = await context.newPage();
  const cdp = await context.newCDPSession(control);
  let registrationId = "";
  cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
    for (const registration of registrations)
      if (registration.scopeURL === origin + "/" && !registration.isDeleted)
        registrationId = registration.registrationId;
  });
  await cdp.send("ServiceWorker.enable");
  await page.getByRole("button", { name: "Enable on this device" }).click();
  await expect(
    page.getByText(
      "Notifications enabled for this device. Choose your reminder types below.",
    ),
  ).toBeVisible();
  await expect.poll(() => registrationId).not.toBe("");
  const worker = context.serviceWorkers()[0];
  expect(worker.url()).toBe(origin + "/sw.js");
  await page.close();
  await cdp.send("ServiceWorker.deliverPushMessage", {
    origin,
    registrationId,
    data: JSON.stringify({
      body: "Your focus session is complete.",
      tag: "e2e-focus",
      url: "/?notification=focus",
    }),
  });
  const notifications = () =>
    worker.evaluate<
      { title: string; body: string; tag: string; url: string }[]
    >(`(async () => {
    const notifications = await self.registration.getNotifications();
    return notifications.map(n => ({title:n.title,body:n.body,tag:n.tag,url:n.data.url}));
  })()`);
  await expect.poll(notifications).toEqual([
    {
      title: "TodoCal",
      body: "Your focus session is complete.",
      tag: "e2e-focus",
      url: origin + "/?notification=focus",
    },
  ]);
  // A second delivery replaces the same notification instead of stacking it.
  await cdp.send("ServiceWorker.deliverPushMessage", {
    origin,
    registrationId,
    data: JSON.stringify({
      body: "Updated reminder.",
      tag: "e2e-focus",
      url: "/?notification=focus",
    }),
  });
  await expect.poll(notifications).toEqual([
    {
      title: "TodoCal",
      body: "Updated reminder.",
      tag: "e2e-focus",
      url: origin + "/?notification=focus",
    },
  ]);
  // A synthetic click has no OS user activation. Capture only the browser
  // openWindow boundary; execute the shipped click handler, then open its URL.
  const destination = await worker.evaluate<string>(`(async () => {
    const notification = (await self.registration.getNotifications())[0];
    return new Promise(resolve => {
      self.clients.openWindow = async url => { resolve(url); return null; };
      self.dispatchEvent(new NotificationEvent('notificationclick', {notification}));
    });
  })()`);
  expect(destination).toBe(origin + "/?notification=focus");
  const opened = await context.newPage();
  await opened.goto(destination);
  await expect(
    opened.getByRole("dialog", { name: "Focus timer", exact: true }),
  ).toBeVisible();
  await expect(
    opened.getByRole("button", { name: "Start session", exact: true }),
  ).toBeVisible();
  expect(
    (await (await opened.request.get("/api/v1/focus")).json()).active,
  ).toBeNull();
});
