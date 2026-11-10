import { DateTime } from "luxon";
import type { CalendarSlot } from "../types/calendarTypes";
export function slotDraft(
  start: string,
  end?: string,
  allDay = false,
): CalendarSlot {
  const a = DateTime.fromISO(start, { zone: "UTC" });
  const b = end
    ? DateTime.fromISO(end, { zone: "UTC" })
    : a.plus({ minutes: 30 });
  return {
    scheduledDate: a.toISODate()!,
    startTime: allDay ? "" : a.toFormat("HH:mm"),
    endTime: allDay
      ? ""
      : b.toISODate() === a.toISODate()
        ? b.toFormat("HH:mm")
        : "23:59",
  };
}
