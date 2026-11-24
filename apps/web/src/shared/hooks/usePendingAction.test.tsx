import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { usePendingAction } from "./usePendingAction";
it("tracks only the initiating promise and clears after success or failure", async () => {
  const { result } = renderHook(usePendingAction);
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  let operation!: Promise<void>;
  act(() => {
    operation = result.current.run("delete:first", () => promise);
  });
  expect(result.current.pending).toBe("delete:first");
  await act(async () => {
    resolve();
    await operation;
  });
  expect(result.current.pending).toBeNull();
  await act(async () => {
    await result.current
      .run("retry", () => Promise.reject(new Error("offline")))
      .catch(() => {});
  });
  expect(result.current.pending).toBeNull();
  await act(async () => {
    await result.current.run("sync", () => undefined);
  });
  expect(result.current.pending).toBeNull();
});
