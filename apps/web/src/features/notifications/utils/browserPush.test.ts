import { afterEach, expect, it, vi } from "vitest";
import { subscribeBrowserPush } from "./browserPush";
afterEach(() => vi.unstubAllGlobals());
it("permission denial does not register a service worker or subscribe", async () => {
  const register = vi.fn();
  vi.stubGlobal("Notification", {
    permission: "default",
    requestPermission: vi.fn().mockResolvedValue("denied"),
  });
  vi.stubGlobal("PushManager", function () {});
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  await expect(subscribeBrowserPush("AQID")).rejects.toThrow("blocked");
  expect(register).not.toHaveBeenCalled();
});
it("reuses an existing browser subscription only after explicit enable", async () => {
  const subscription = {
    endpoint: "https://fcm.googleapis.com/device",
    toJSON: () => ({
      endpoint: "https://fcm.googleapis.com/device",
      keys: { p256dh: "key", auth: "auth" },
    }),
  };
  const subscribe = vi.fn();
  const registration = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(subscription),
      subscribe,
    },
  };
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.stubGlobal("PushManager", function () {});
  const register = vi.fn().mockResolvedValue(registration);
  vi.stubGlobal("navigator", {
    serviceWorker: { register, ready: Promise.resolve(registration) },
  });
  expect(await subscribeBrowserPush("AQID")).toEqual(subscription.toJSON());
  expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  expect(subscribe).not.toHaveBeenCalled();
});
it("subscribes with the configured public key and user-visible notifications", async () => {
  const subscribe = vi.fn().mockResolvedValue({
    toJSON: () => ({
      endpoint: "https://fcm.googleapis.com/new",
      keys: { p256dh: "key", auth: "auth" },
    }),
  });
  const registration = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe,
    },
  };
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.stubGlobal("PushManager", function () {});
  vi.stubGlobal("navigator", {
    serviceWorker: {
      register: vi.fn().mockResolvedValue(registration),
      ready: Promise.resolve(registration),
    },
  });
  await subscribeBrowserPush("AQID");
  expect(subscribe).toHaveBeenCalledWith({
    userVisibleOnly: true,
    applicationServerKey: new Uint8Array([1, 2, 3]),
  });
});
