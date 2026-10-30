import { it, expect, vi } from "vitest";
import { apiFetch, ApiError } from "./apiClient";
it("keeps the idempotency key and exact body for a retry, and sends cookies and CSRF", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(new Response('{"id":"1"}'));
  const options = {
    method: "POST",
    body: { title: "Read" },
    csrf: "token",
    key: "stable-command-key",
  };
  await expect(apiFetch("/tasks", options)).rejects.toThrow();
  await expect(apiFetch("/tasks", options)).resolves.toEqual({ id: "1" });
  const first = fetcher.mock.calls[0][1]!;
  const second = fetcher.mock.calls[1][1]!;
  expect(first.body).toBe(second.body);
  expect(first.credentials).toBe("same-origin");
  expect(new Headers(first.headers).get("Idempotency-Key")).toBe(
    "stable-command-key",
  );
  expect(new Headers(first.headers).get("X-CSRF-Token")).toBe("token");
});
it("retains HTTP errors as typed failures", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      '{"error":{"message":"Changed elsewhere","code":"conflict"}}',
      { status: 409 },
    ),
  );
  await expect(apiFetch("/tasks")).rejects.toMatchObject({
    status: 409,
    message: "Changed elsewhere",
  });
});
it("rejects data from a different cookie account before it enters the cache", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response('{"title":"Account B private task"}', {
      headers: { "X-Account-ID": "B" },
    }),
  );
  await expect(apiFetch("/tasks", { owner: "A" })).rejects.toMatchObject({
    status: 401,
    code: "account_changed",
  });
});
it("explains Undo expiry distinctly from a revision conflict", async () => {
  const { errorMessage } = await import("./apiClient");
  expect(
    errorMessage(
      new ApiError(409, "This undo is no longer available", "undo_expired"),
    ),
  ).toBe("This undo is no longer available");
});
