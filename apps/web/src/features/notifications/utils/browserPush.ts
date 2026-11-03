export function supportsBrowserPush() {
  return (
    typeof Notification !== "undefined" &&
    typeof PushManager !== "undefined" &&
    "serviceWorker" in navigator
  );
}

// Called only by an explicit Enable action, never during page load.
export async function subscribeBrowserPush(publicKey: string) {
  if (!supportsBrowserPush())
    throw new Error(
      "Background notifications are not supported by this browser. On iOS, install TodoCal on your Home Screen first.",
    );
  if (!publicKey)
    throw new Error("Background notifications are not configured yet.");
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== "granted")
    throw new Error(
      "Notifications are blocked. You can allow them in browser settings; tasks and Focus still work.",
    );
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const raw = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/"));
    const applicationServerKey = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }
  const result = subscription.toJSON();
  if (!result.endpoint || !result.keys?.p256dh || !result.keys.auth)
    throw new Error(
      "The browser did not provide a valid notification subscription.",
    );
  return {
    endpoint: result.endpoint,
    deviceName: browserDeviceName(),
    keys: { p256dh: result.keys.p256dh, auth: result.keys.auth },
  };
}

/** Inspect only: never registers a worker or asks for permission. */
export async function currentBrowserPushHash(): Promise<string | null> {
  if (!supportsBrowserPush() || Notification.permission !== "granted")
    return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return null;
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(subscription.endpoint),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function browserDeviceName(): string {
  const ua = navigator.userAgent || "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const platform = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "this device";
  return `${browser} · ${platform}`;
}
