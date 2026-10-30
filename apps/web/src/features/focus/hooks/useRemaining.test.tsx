import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useRemaining } from "./useRemaining";
import { timerLabel } from "../utils/clock";

const active = {
  id: "focus-session",
  kind: "focus" as const,
  status: "running" as const,
  targetSeconds: 1500,
  elapsedSeconds: 0,
};

function Clock({ receivedAt }: { receivedAt: number }) {
  return <span>{timerLabel(useRemaining(active as any, receivedAt))}</span>;
}

it("keeps newly mounted clocks synchronized with an existing session", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-30T00:00:00.000Z"));
    const receivedAt = performance.now();
    const first = render(<Clock receivedAt={receivedAt} />);
    expect(first.getByText("25:00")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(60_000));
    expect(first.getByText("24:00")).toBeInTheDocument();

    // Opening a panel must not restart the old snapshot at 25:00.
    const second = render(<Clock receivedAt={receivedAt} />);
    expect(screen.getAllByText("24:00")).toHaveLength(2);
    first.unmount();
    second.unmount();
  } finally {
    vi.useRealTimers();
  }
});

it("does not tick while paused", () => {
  vi.useFakeTimers();
  try {
    const paused = {
      ...active,
      status: "paused" as const,
      elapsedSeconds: 60,
    };
    function PausedClock() {
      const remaining = useRemaining(paused as any, performance.now());
      return <span>{timerLabel(remaining)}</span>;
    }
    const view = render(<PausedClock />);
    expect(screen.getByText("24:00")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("24:00")).toBeInTheDocument();
    view.unmount();
  } finally {
    vi.useRealTimers();
  }
});
