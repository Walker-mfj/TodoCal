import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Calendar from "./calendar";
import { useToday } from "../../../../shared/hooks/useToday";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("moves today's highlight at midnight and keeps navigation on the selected week", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T14:59:59Z"));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  function ClockCalendar() {
    const date = useToday("Asia/Tokyo");
    return (
      <Calendar
        timezone="Asia/Tokyo"
        today={date}
        days={[]}
        groups={[]}
        onRange={vi.fn()}
        onTask={vi.fn()}
        onCreate={vi.fn()}
        filter={() => true}
        disabled={false}
        onSchedule={vi.fn()}
        onScheduleError={vi.fn()}
        focus={{} as any}
        defaultFocusMinutes={25}
        onOpenFocus={vi.fn()}
      />
    );
  }
  const { container, getByRole } = render(<ClockCalendar />);
  expect(
    container.querySelector(".fc-timegrid-col.fc-day-today"),
  ).toHaveAttribute("data-date", "2026-11-16");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(
    container.querySelector(".fc-timegrid-col.fc-day-today"),
  ).toHaveAttribute("data-date", "2026-11-17");
  fireEvent.click(getByRole("button", { name: "Next" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(container.querySelector(".fc-timegrid-col.fc-day-today")).toBeNull();
  fireEvent.click(getByRole("button", { name: "Today" }));
  expect(
    container.querySelector(".fc-timegrid-col.fc-day-today"),
  ).toHaveAttribute("data-date", "2026-11-17");
});
