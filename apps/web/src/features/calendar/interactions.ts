import { DateTime } from "luxon";
import type { Task } from "../../lib/model";
export type Schedule = {
  scheduledDate: string | null;
  startTime: string | null;
  endTime: string | null;
};
export function scheduleFromDrop(
  task: Pick<Task, "startTime" | "endTime"> & { scheduledDate?: string | null },
  start: string,
  end: string | undefined,
  allDay: boolean,
  kind: "move" | "resize" | "month",
): Schedule {
  const date = start.slice(0, 10);
  if (kind === "month")
    return {
      scheduledDate: date,
      startTime: task.startTime,
      endTime: task.endTime,
    };
  if (allDay) return { scheduledDate: date, startTime: null, endTime: null };
  const a = DateTime.fromISO(start, { zone: "UTC" });
  const snap = (value: DateTime) =>
    value.startOf("day").plus({
      minutes: Math.round((value.hour * 60 + value.minute) / 15) * 15,
    });
  const from =
    kind === "resize" && a.toFormat("HH:mm") === task.startTime ? a : snap(a);
  const duration =
    task.startTime && task.endTime
      ? DateTime.fromISO(`2000-01-01T${task.endTime}`, { zone: "UTC" }).diff(
          DateTime.fromISO(`2000-01-01T${task.startTime}`, { zone: "UTC" }),
          "minutes",
        ).minutes
      : 30;
  const rawEnd = end ? DateTime.fromISO(end, { zone: "UTC" }) : null;
  const to =
    kind === "resize" && rawEnd
      ? rawEnd.toFormat("HH:mm") === task.endTime
        ? rawEnd
        : snap(rawEnd)
      : from.plus({ minutes: duration });
  if (
    !from.isValid ||
    !to.isValid ||
    from.toISODate() !== date ||
    to.toISODate() !== date
  )
    throw new Error(
      "Tasks cannot cross midnight. Choose a time range within one day.",
    );
  if (to <= from) throw new Error("End time must be after start time.");
  return {
    scheduledDate: date,
    startTime: from.toFormat("HH:mm"),
    endTime: to.toFormat("HH:mm"),
  };
}
