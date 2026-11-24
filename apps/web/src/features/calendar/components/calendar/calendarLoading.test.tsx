import { render, screen } from "@testing-library/react";
import { expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ComponentProps } from "react";
import Calendar from "./calendar";
vi.mock("@fullcalendar/react", () => ({
  default: (props: { dayHeaderContent: (arg: unknown) => unknown }) => (
    <div>
      {
        props.dayHeaderContent({
          text: "Monday",
          date: new Date("2026-11-23T00:00:00Z"),
          view: { type: "timeGridWeek" },
        }) as React.ReactNode
      }
    </div>
  ),
}));
beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  ),
);
afterEach(() => vi.unstubAllGlobals());
const props = {
  days: [],
  groups: [],
  today: "2026-11-23",
  timezone: "UTC",
  onRange: vi.fn(),
  onTask: vi.fn(),
  onCreate: vi.fn(),
  filter: () => true,
  disabled: false,
  onSchedule: vi.fn(),
  onScheduleError: vi.fn(),
  focus: {
    active: null,
    receivedAt: 0,
    blocked: false,
    start: vi.fn(),
    change: vi.fn(),
  },
  defaultFocusMinutes: 25,
  onOpenFocus: vi.fn(),
} as ComponentProps<typeof Calendar>;
it("shows a visible noninteractive missing-day placeholder only during actual fetch", () => {
  const { container, rerender } = render(<Calendar {...props} loading />);
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  const placeholder = container.querySelector(".calendar-progress-placeholder");
  expect(placeholder).not.toBeNull();
  expect(placeholder?.tagName).toBe("SPAN");
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<Calendar {...props} loading={false} />);
  expect(container.querySelector(".calendar-progress-placeholder")).toBeNull();
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
});
