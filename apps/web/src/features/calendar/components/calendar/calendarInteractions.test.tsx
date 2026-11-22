import { render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Calendar from "./calendar";
import type { CalendarOptions } from "@fullcalendar/core";
const capture = vi.hoisted(() => ({ props: {} as CalendarOptions }));
vi.mock("@fullcalendar/react", () => ({
  default: (props: CalendarOptions) => {
    capture.props = props;
    return null;
  },
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
function calendar(overrides: Record<string, unknown> = {}) {
  const onCreate = vi.fn(),
    onSchedule = vi.fn(),
    onScheduleError = vi.fn();
  render(
    <Calendar
      {...{
        days: [],
        groups: [],
        today: "2030-03-10",
        timezone: "Asia/Tokyo",
        onRange: vi.fn(),
        onTask: vi.fn(),
        onCreate,
        filter: () => true,
        disabled: false,
        onSchedule,
        onScheduleError,
        focus: {} as any,
        defaultFocusMinutes: 25,
        onOpenFocus: vi.fn(),
        ...overrides,
      }}
    />,
  );
  return { onCreate, onSchedule, onScheduleError };
}
it("keeps fifteen-minute snapping and wall-clock slots across the DST date", () => {
  const { onCreate } = calendar();
  expect(capture.props.snapDuration).toBe("00:15:00");
  expect(capture.props.timeZone).toBe("UTC");
  (capture.props.dateClick as Function)({
    dateStr: "2030-03-10T01:45:00Z",
    allDay: false,
  });
  expect(onCreate).toHaveBeenCalledWith({
    scheduledDate: "2030-03-10",
    startTime: "01:45",
    endTime: "02:15",
  });
});
it("reverts a persisted drag before sending the authoritative schedule", () => {
  const { onSchedule } = calendar();
  const task = {
    id: "task",
    revision: 7,
    startTime: "09:00",
    endTime: "10:00",
  };
  const revert = vi.fn();
  (capture.props.eventDrop as Function)({
    oldEvent: { extendedProps: { task } },
    event: {
      startStr: "2030-03-11T10:15:00Z",
      endStr: "2030-03-11T11:15:00Z",
      allDay: false,
    },
    view: { type: "timeGridWeek" },
    revert,
  });
  expect(revert).toHaveBeenCalledOnce();
  expect(onSchedule).toHaveBeenCalledWith(task, {
    scheduledDate: "2030-03-11",
    startTime: "10:15",
    endTime: "11:15",
    scheduledStartAt: "2030-03-11T01:15:00.000Z",
    scheduledEndAt: "2030-03-11T02:15:00.000Z",
  });
  expect(revert.mock.invocationCallOrder[0]).toBeLessThan(
    onSchedule.mock.invocationCallOrder[0],
  );
});
it("resizes previews through the draft callback without persisting them", () => {
  const { onCreate, onSchedule } = calendar({
    draftPreview: {
      draft: {
        title: "Unsaved",
        scheduledDate: "2030-03-10",
        startTime: "09:00",
        endTime: "10:00",
      },
    },
  });
  const revert = vi.fn();
  (capture.props.eventResize as Function)({
    oldEvent: { extendedProps: { draft: true } },
    event: {
      startStr: "2030-03-10T09:00:00Z",
      endStr: "2030-03-10T10:15:00Z",
      allDay: false,
    },
    revert,
  });
  expect(revert).toHaveBeenCalledOnce();
  expect(onCreate).toHaveBeenCalledWith({
    scheduledDate: "2030-03-10",
    startTime: "09:00",
    endTime: "10:15",
  });
  expect(onSchedule).not.toHaveBeenCalled();
});

it("uses the account wall clock for the current-time indicator", () => {
  calendar();
  expect(capture.props.now).toBeTypeOf("function");
  expect(capture.props.nowIndicator).toBe(true);
});
