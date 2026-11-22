import { DateTime } from "luxon";
import type { Task } from "../../../shared/api/domainTypes";
import { localScheduleEndpoint } from "../../../shared/utils/taskSchedule";

export type Schedule = {
  scheduledDate: string | null;
  scheduledEndDate?: string | null;
  startTime: string | null;
  endTime: string | null;
};
type Original = Pick<Task, "startTime" | "endTime"> &
  Partial<
    Pick<
      Task,
      | "scheduledDate"
      | "scheduledEndDate"
      | "scheduledStartAt"
      | "scheduledEndAt"
    >
  >;

export function scheduleFromDrop(
  task: Original,
  start: string,
  end: string | undefined,
  allDay: boolean,
  kind: "move" | "resize" | "month",
  zone = "UTC",
): Schedule {
  const date = start.slice(0, 10);
  const wallClock = (value: string) => DateTime.fromISO(value, { zone: "UTC" });
  const oldDate = task.scheduledDate ?? "2000-01-01";
  const oldEndDate = task.scheduledEndDate ?? oldDate;
  const priorOvernight = oldEndDate !== oldDate;
  if (allDay && kind !== "month") {
    return {
      scheduledDate: date,
      startTime: null,
      endTime: null,
      ...(priorOvernight ? { scheduledEndDate: null } : {}),
    };
  }
  if (kind === "month") {
    const offset = wallClock(oldEndDate).diff(wallClock(oldDate), "days").days;
    const endDate = wallClock(date).plus({ days: offset }).toISODate();
    return {
      scheduledDate: date,
      startTime: task.startTime,
      endTime: task.endTime,
      ...(priorOvernight ? { scheduledEndDate: endDate } : {}),
    };
  }

  const snap = (value: DateTime) =>
    value.startOf("day").plus({
      minutes: Math.round((value.hour * 60 + value.minute) / 15) * 15,
    });
  const a = wallClock(start);
  const fromWall =
    kind === "resize" && a.toFormat("HH:mm") === task.startTime ? a : snap(a);
  const fromDate = fromWall.toISODate()!;
  const fromTime = fromWall.toFormat("HH:mm");
  const from = localScheduleEndpoint(fromDate, fromTime, zone);

  const duration =
    task.scheduledStartAt && task.scheduledEndAt
      ? DateTime.fromISO(task.scheduledEndAt).diff(
          DateTime.fromISO(task.scheduledStartAt),
          "minutes",
        ).minutes
      : task.startTime && task.endTime
        ? wallClock(`${oldEndDate}T${task.endTime}`).diff(
            wallClock(`${oldDate}T${task.startTime}`),
            "minutes",
          ).minutes
        : 30;
  const rawEnd = end ? wallClock(end) : null;
  const toWall =
    rawEnd &&
    (rawEnd.toFormat("HH:mm") === task.endTime ? rawEnd : snap(rawEnd));
  const to =
    kind === "resize" && toWall
      ? localScheduleEndpoint(
          toWall.toISODate()!,
          toWall.toFormat("HH:mm"),
          zone,
        )
      : from?.plus({ minutes: duration });
  if (!from || !to)
    throw new Error("This scheduled time does not exist in your timezone.");
  if (to <= from) throw new Error("End time must be after start time.");
  const toDate = to.toISODate()!;
  return {
    scheduledDate: fromDate,
    startTime: fromTime,
    endTime: to.toFormat("HH:mm"),
    ...(toDate !== fromDate
      ? { scheduledEndDate: toDate }
      : priorOvernight
        ? { scheduledEndDate: null }
        : {}),
  };
}
