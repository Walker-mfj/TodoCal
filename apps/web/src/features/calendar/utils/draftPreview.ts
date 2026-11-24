import { DateTime } from "luxon";
import type { EventInput } from "@fullcalendar/core";
import { localScheduleEndpoint } from "../../../shared/utils/taskSchedule";
import type { CalendarDraft } from "../types/calendarTypes";
export type { CalendarDraft } from "../types/calendarTypes";
export function draftEvent(
  preview?: CalendarDraft | null,
  zone = "UTC",
): EventInput | null {
  if (!preview) return null;
  const { draft } = preview;
  const date = draft.scheduledDate;
  if (
    !date ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    DateTime.fromISO(date, { zone: "UTC" }).toISODate() !== date
  )
    return null;
  const timed = !!(draft.startTime || draft.endTime);
  const endDate = draft.scheduledEndDate || date;
  if (timed) {
    const from = localScheduleEndpoint(date, draft.startTime || "", zone);
    const to = localScheduleEndpoint(endDate, draft.endTime || "", zone);
    if (!from || !to || to <= from) return null;
  }
  return {
    id: "editor-draft",
    title: draft.title.trim() || "New task",
    start: date + (timed ? `T${draft.startTime}:00` : ""),
    end: timed ? `${endDate}T${draft.endTime}:00` : undefined,
    allDay: !timed,
    editable: true,
    classNames: ["fc-event-draft"],
    extendedProps: { draft: true, priority: draft.priority },
  };
}
