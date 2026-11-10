import type { EventDropArg, DateSelectArg } from "@fullcalendar/core";
import type {
  EventResizeDoneArg,
  EventReceiveArg,
  DateClickArg,
} from "@fullcalendar/interaction";
import type { Task } from "../../../shared/api/domainTypes";
import type { CalendarDraft, CalendarSlot } from "../types/calendarTypes";
import { scheduleFromDrop, type Schedule } from "./interactions";
import { slotDraft } from "./slotDraft";
type Options = {
  draftPreview?: CalendarDraft | null;
  disabled: boolean;
  draftDisabled: boolean;
  onCreate: (slot: CalendarSlot) => void;
  onSchedule: (task: Task, schedule: Schedule) => void;
  onScheduleError: (error: unknown) => void;
};
export function calendarInteractions({
  draftPreview,
  disabled,
  draftDisabled,
  onCreate,
  onSchedule,
  onScheduleError,
}: Options) {
  const moveDraft = (
    start: string,
    end: string | undefined,
    allDay: boolean,
    kind: "move" | "resize" | "month",
  ) => {
    if (!draftPreview || disabled || draftDisabled) return;
    const schedule = scheduleFromDrop(
      {
        startTime: draftPreview.draft.startTime || null,
        endTime: draftPreview.draft.endTime || null,
      },
      start,
      end,
      allDay,
      kind,
    );
    onCreate({
      scheduledDate: schedule.scheduledDate || "",
      startTime: schedule.startTime || "",
      endTime: schedule.endTime || "",
    });
  };
  return {
    eventDrop: (arg: EventDropArg) => {
      try {
        if (arg.oldEvent.extendedProps.draft) {
          const { startStr, endStr, allDay } = arg.event;
          arg.revert();
          moveDraft(
            startStr,
            endStr || undefined,
            allDay,
            arg.view.type === "dayGridMonth" ? "month" : "move",
          );
          return;
        }
        const task = arg.oldEvent.extendedProps.task as Task;
        const schedule = scheduleFromDrop(
          task,
          arg.event.startStr,
          arg.event.endStr || undefined,
          arg.event.allDay,
          arg.view.type === "dayGridMonth" ? "month" : "move",
        );
        arg.revert();
        onSchedule(task, schedule);
      } catch (error) {
        arg.revert();
        onScheduleError(error);
      }
    },
    eventResize: (arg: EventResizeDoneArg) => {
      try {
        if (arg.oldEvent.extendedProps.draft) {
          const { startStr, endStr, allDay } = arg.event;
          arg.revert();
          moveDraft(startStr, endStr || undefined, allDay, "resize");
          return;
        }
        const task = arg.oldEvent.extendedProps.task as Task;
        const schedule = scheduleFromDrop(
          task,
          arg.event.startStr,
          arg.event.endStr || undefined,
          arg.event.allDay,
          "resize",
        );
        arg.revert();
        onSchedule(task, schedule);
      } catch (error) {
        arg.revert();
        onScheduleError(error);
      }
    },
    eventReceive: (arg: EventReceiveArg) => {
      try {
        const task = arg.event.extendedProps.task as Task;
        const schedule = scheduleFromDrop(
          task,
          arg.event.startStr,
          arg.event.endStr || undefined,
          arg.event.allDay,
          arg.view.type === "dayGridMonth" ? "month" : "move",
        );
        arg.revert();
        onSchedule(task, schedule);
      } catch (error) {
        arg.revert();
        onScheduleError(error);
      }
    },
    dateClick: (arg: DateClickArg) => {
      if (!disabled) onCreate(slotDraft(arg.dateStr, undefined, arg.allDay));
    },
    select: (arg: DateSelectArg) => {
      if (
        !disabled &&
        (arg.allDay || arg.startStr.slice(0, 10) === arg.endStr.slice(0, 10))
      )
        onCreate(slotDraft(arg.startStr, arg.endStr, arg.allDay));
      arg.view.calendar.unselect();
    },
  };
}
