import { DateTime } from "luxon";
import type { Draft } from "../../tasks/types/taskTypes";
export function slotDraft(
  start: string,
  end?: string,
  allDay = false,
): Partial<Draft> {
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
