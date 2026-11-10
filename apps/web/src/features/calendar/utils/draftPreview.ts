import { DateTime } from "luxon";
import type { EventInput } from "@fullcalendar/core";
import type { CalendarDraft } from "../types/calendarTypes";
export type { CalendarDraft } from "../types/calendarTypes";
export function draftEvent(preview?: CalendarDraft | null): EventInput | null {
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
  const validTime = (time?: string) =>
    !!time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  if (
    timed &&
    (!validTime(draft.startTime) ||
      !validTime(draft.endTime) ||
      draft.endTime! <= draft.startTime!)
  )
    return null;
  return {
    id: "editor-draft",
    title: draft.title.trim() || "New task",
    start: date + (timed ? `T${draft.startTime}:00` : ""),
    end: timed ? `${date}T${draft.endTime}:00` : undefined,
    allDay: !timed,
    editable: true,
    classNames: ["fc-event-draft"],
    extendedProps: { draft: true, priority: draft.priority },
  };
}
