import { DateTime } from "luxon";
import type { Draft } from "../types/taskTypes";
import type { Task } from "../../../shared/api/domainTypes";
import type { components } from "../../../shared/api/apiTypes.generated";
export class FieldError extends Error {
  constructor(
    public field: keyof Draft,
    message: string,
  ) {
    super(message);
  }
}

export function taskPayload(
  d: Draft,
  zone: string,
): components["schemas"]["TaskInput"] {
  if (!d.title.trim()) throw new FieldError("title", "Add a task title.");
  if (
    d.focusMinutes &&
    (!Number.isInteger(Number(d.focusMinutes)) ||
      Number(d.focusMinutes) < 1 ||
      Number(d.focusMinutes) > 180)
  )
    throw new FieldError(
      "focusMinutes",
      "Choose a session duration between 1 and 180 minutes.",
    );
  if (
    !!d.startTime !== !!d.endTime ||
    (d.startTime && (!d.scheduledDate || d.startTime >= d.endTime!))
  )
    throw new FieldError(
      !d.scheduledDate
        ? "scheduledDate"
        : !d.startTime
          ? "startTime"
          : "endTime",
      "Choose a date and an end time after the start time.",
    );
  if (d.cadence && d.cadence !== "none") {
    if (!d.scheduledDate)
      throw new FieldError(
        "scheduledDate",
        "Choose a start date for repeating tasks.",
      );
    if (d.endDate && d.endDate < d.scheduledDate)
      throw new FieldError(
        "endDate",
        "End date must be on or after the start date.",
      );
    if (
      d.cadence === "interval" &&
      (!Number.isInteger(d.intervalDays) ||
        d.intervalDays! < 2 ||
        d.intervalDays! > 365)
    )
      throw new FieldError(
        "intervalDays",
        "Choose an interval between 2 and 365 days.",
      );
  }
  let deadline: string | null = null;
  if (d.deadline) {
    const local = DateTime.fromISO(d.deadline, { zone });
    if (!local.isValid || local.toFormat("yyyy-MM-dd'T'HH:mm") !== d.deadline)
      throw new FieldError(
        "deadline",
        "This deadline does not exist in your timezone.",
      );
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
    focusMinutes: d.focusMinutes ? Number(d.focusMinutes) : null,
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
    focusMinutes: task.focusMinutes?.toString() || "",
  };
}
