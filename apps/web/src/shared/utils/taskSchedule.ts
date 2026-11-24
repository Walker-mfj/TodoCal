import { DateTime } from "luxon";
import type { Task } from "../api/domainTypes";

export function localScheduleEndpoint(
  date: string,
  time: string,
  zone: string,
) {
  const value = `${date}T${time}`;
  const local = DateTime.fromISO(value, { zone });
  if (!local.isValid || local.toFormat("yyyy-MM-dd'T'HH:mm") !== value)
    return null;
  return local
    .getPossibleOffsets()
    .reduce((first, candidate) => (candidate < first ? candidate : first));
}

export function taskSchedule(task: Task, zone?: string) {
  if (zone && task.scheduledStartAt && task.scheduledEndAt) {
    const start = DateTime.fromISO(task.scheduledStartAt, { zone });
    const end = DateTime.fromISO(task.scheduledEndAt, { zone });
    if (start.isValid && end.isValid) {
      return {
        scheduledDate: start.toISODate(),
        scheduledEndDate: end.toISODate(),
        startTime: start.toFormat("HH:mm"),
        endTime: end.toFormat("HH:mm"),
      };
    }
  }
  return {
    scheduledDate: task.scheduledDate,
    scheduledEndDate: task.scheduledEndDate ?? task.scheduledDate,
    startTime: task.startTime,
    endTime: task.endTime,
  };
}
