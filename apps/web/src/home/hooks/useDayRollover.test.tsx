import { act, renderHook } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useToday } from "../../shared/hooks/useToday";
import { useDayRollover } from "./useDayRollover";
afterEach(() => vi.useRealTimers());
it("refreshes only date-dependent queries of the current account on rollover and wake", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T14:59:00Z"));
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const key = ["owner", "calendar", "/calendar?from=2026-11-16&to=2026-11-23"];
  const queryFn = vi.fn(async () => ({
    finalized: Date.now() >= Date.parse("2026-11-16T15:00:00Z"),
  }));
  await client.fetchQuery({ queryKey: key, queryFn });
  const observer = new QueryObserver(client, { queryKey: key, queryFn });
  const unsubscribe = observer.subscribe(() => {});
  for (const name of ["period", "day", "tasks", "groups"])
    client.setQueryData(["owner", name, "/fixed"], {});
  client.setQueryData(["other", "calendar"], {});
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { unmount } = renderHook(
    () => useDayRollover("owner", useToday("Asia/Tokyo")),
    { wrapper },
  );
  expect(queryFn).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(queryFn).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(key)).toEqual({ finalized: true });
  for (const name of ["period", "day", "tasks"])
    expect(client.getQueryState(["owner", name, "/fixed"])?.isInvalidated).toBe(
      true,
    );
  expect(
    client.getQueryState(["owner", "groups", "/fixed"])?.isInvalidated,
  ).toBe(false);
  expect(client.getQueryState(["other", "calendar"])?.isInvalidated).toBe(
    false,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(queryFn).toHaveBeenCalledTimes(2);
  vi.setSystemTime(new Date("2026-11-18T01:00:00Z"));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(queryFn).toHaveBeenCalledTimes(3);
  unmount();
  unsubscribe();
  client.clear();
});
