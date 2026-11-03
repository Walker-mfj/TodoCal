import { expect, it, vi } from "vitest";
import { renewSession } from "./renewSession";
it("coalesces expired-session recovery and returns the renewed account", async () => {
  let valid = false,
    refreshes = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url).endsWith("/auth/refresh")) {
      refreshes++;
      valid = true;
      return new Response("{}");
    }
    return valid
      ? new Response(
          JSON.stringify({ user: { id: "a" }, csrfToken: "new", settings: {} }),
        )
      : new Response("{}", { status: 401 });
  });
  const results = await Promise.all([renewSession(), renewSession()]);
  expect(refreshes).toBe(1);
  expect(results[0].user.id).toBe("a");
  expect(results[1].csrfToken).toBe("new");
});
it("does not refresh when another tab has already renewed the session", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(
        JSON.stringify({ user: { id: "a" }, csrfToken: "fresh", settings: {} }),
      ),
    );
  expect((await renewSession()).csrfToken).toBe("fresh");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("propagates idle expiry instead of looping", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => new Response("{}", { status: 401 }));
  await expect(renewSession()).rejects.toMatchObject({ status: 401 });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("serializes account-changing requests behind an in-flight credential refresh", async () => {
  const { withSessionLock } = await import("./renewSession");
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let renewed = false;
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url).endsWith("/auth/refresh")) {
      calls.push("refresh-start");
      await delayed;
      renewed = true;
      calls.push("refresh-cookie-written");
      return new Response("{}");
    }
    return renewed
      ? new Response(
          JSON.stringify({
            user: { id: "a" },
            csrfToken: "fresh",
            settings: {},
          }),
        )
      : new Response("{}", { status: 401 });
  });
  const renewing = renewSession();
  await vi.waitFor(() => expect(calls).toContain("refresh-start"));
  const login = withSessionLock(async () => {
    calls.push("login-cookie-written");
  });
  await Promise.resolve();
  expect(calls).not.toContain("login-cookie-written");
  release();
  await Promise.all([renewing, login]);
  expect(calls).toEqual([
    "refresh-start",
    "refresh-cookie-written",
    "login-cookie-written",
  ]);
});
