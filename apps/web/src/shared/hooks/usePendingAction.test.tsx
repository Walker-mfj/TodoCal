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
  expect(result.current.isPending("delete:first")).toBe(true);
  await act(async () => {
    resolve();
    await operation;
  });
  expect(result.current.isPending("delete:first")).toBe(false);
  await act(async () => {
    await result.current
      .run("retry", () => Promise.reject(new Error("offline")))
      .catch(() => {});
  });
  expect(result.current.isPending("retry")).toBe(false);
  await act(async () => {
    await result.current.run("sync", () => undefined);
  });
  expect(result.current.isPending("delete:first")).toBe(false);
});
it("retains independent keys and same-key requests completing out of order", async () => {
  const { result } = renderHook(usePendingAction);
  let finishA!: () => void, finishB!: () => void, finishA2!: () => void;
  let a!: Promise<void>, b!: Promise<void>, a2!: Promise<void>;
  act(() => {
    a = result.current.run(
      "primary",
      () =>
        new Promise<void>((r) => {
          finishA = r;
        }),
    );
    b = result.current.run(
      "permission",
      () =>
        new Promise<void>((r) => {
          finishB = r;
        }),
    );
    a2 = result.current.run(
      "primary",
      () =>
        new Promise<void>((r) => {
          finishA2 = r;
        }),
    );
  });
  expect(result.current.isPending("primary")).toBe(true);
  expect(result.current.isPending("permission")).toBe(true);
  await act(async () => {
    finishB();
    await b;
    finishA2();
    await a2;
  });
  expect(result.current.isPending("primary")).toBe(true);
  expect(result.current.isPending("permission")).toBe(false);
  await act(async () => {
    finishA();
    await a;
  });
  expect(result.current.isPending("primary")).toBe(false);
});
