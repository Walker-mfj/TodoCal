import { DateTime } from "luxon";
import type { components } from "./api-types";
export type Task = components["schemas"]["Task"];
export type Group = components["schemas"]["Group"];
export type Settings = components["schemas"]["Settings"];
export type Day = components["schemas"]["DayReport"];
export type CalendarRange = components["schemas"]["CalendarRange"];
export type Session = components["schemas"]["Session"] & { settings: Settings };
export type Draft = {
  title: string;
  description?: string;
  groupId?: string;
  priority?: Task["priority"];
  scheduledDate?: string;
  startTime?: string;
  endTime?: string;
  deadline?: string;
  estimatedPomodoros?: string;
  cadence?: string;
  intervalDays?: number;
  endDate?: string;
};
export function today(zone: string) {
  return DateTime.now().setZone(zone).toISODate()!;
}
export function dateLabel(date: string, format = "MMM d, yyyy") {
  return DateTime.fromISO(date, { zone: "UTC" }).toFormat(format);
}
export function recurrenceSummary(cadence: string, interval = 2, end = "") {
  const text =
    cadence === "daily"
      ? "Every day"
      : cadence === "weekly"
        ? "Every week"
        : cadence === "interval"
          ? `Every ${interval} days`
          : "Does not repeat";
  return (
    text +
    (cadence && cadence !== "none" && end
      ? ` · through ${dateLabel(end)} (inclusive)`
      : "")
  );
}
export function taskPayload(
  d: Draft,
  zone: string,
): components["schemas"]["TaskInput"] {
  if (!d.title.trim()) throw new Error("Add a task title.");
  if (
    !!d.startTime !== !!d.endTime ||
    (d.startTime && (!d.scheduledDate || d.startTime >= d.endTime!))
  )
    throw new Error("Choose a date and an end time after the start time.");
  if (d.cadence && d.cadence !== "none") {
    if (!d.scheduledDate)
      throw new Error("Choose a start date for repeating tasks.");
    if (d.endDate && d.endDate < d.scheduledDate)
      throw new Error("End date must be on or after the start date.");
    if (
      d.cadence === "interval" &&
      (!Number.isInteger(d.intervalDays) ||
        d.intervalDays! < 2 ||
        d.intervalDays! > 365)
    )
      throw new Error("Choose an interval between 2 and 365 days.");
  }
  let deadline: string | null = null;
  if (d.deadline) {
    const local = DateTime.fromISO(d.deadline, { zone });
    if (!local.isValid || local.toFormat("yyyy-MM-dd'T'HH:mm") !== d.deadline)
      throw new Error("This deadline does not exist in your timezone.");
    deadline = local
      .getPossibleOffsets()
      .sort((a, b) => a.toMillis() - b.toMillis())[0]
      .toUTC()
      .toISO();
  }
  return {
    title: d.title.trim(),
    description: d.description || "",
    groupId: d.groupId || null,
    priority: d.priority || "medium",
    scheduledDate: d.scheduledDate || null,
    startTime: d.startTime || null,
    endTime: d.endTime || null,
    deadline,
    estimatedPomodoros: d.estimatedPomodoros
      ? Number(d.estimatedPomodoros)
      : null,
  };
}
export function draftFromTask(task: Task, zone: string): Draft {
  return {
    ...task,
    groupId: task.groupId || "",
    scheduledDate: task.scheduledDate || "",
    startTime: task.startTime || "",
    endTime: task.endTime || "",
    deadline: task.deadline
      ? DateTime.fromISO(task.deadline)
          .setZone(zone)
          .toFormat("yyyy-MM-dd'T'HH:mm")
      : "",
    estimatedPomodoros: task.estimatedPomodoros?.toString() || "",
  };
}
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
export function progressLevel(value: number | null) {
  return value === null
    ? "empty"
    : value === 0
      ? "zero"
      : value < 50
        ? "starting"
        : value < 80
          ? "building"
          : value < 100
            ? "strong"
            : "complete";
}
