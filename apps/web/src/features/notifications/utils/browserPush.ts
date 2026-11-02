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
    keys: { p256dh: result.keys.p256dh, auth: result.keys.auth },
  };
}
