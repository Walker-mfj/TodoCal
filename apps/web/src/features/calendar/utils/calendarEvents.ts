import type { EventInput } from "@fullcalendar/core";
import type { Day, Group, Task } from "../../../shared/api/domainTypes";
import { taskSchedule } from "../../../shared/utils/taskSchedule";
import type { CalendarDraft } from "../types/calendarTypes";
import { clockChangeSegments } from "./clockChangeSegments";
import { draftEvent } from "./draftPreview";

export function calendarEvents({
  tasks = [],
  days,
  groups,
  filter,
  disabled,
  zone = "UTC",
  draftPreview,
}: {
  tasks?: Task[];
  days: Day[];
  groups: Group[];
  filter: (task: Task) => boolean;
  disabled: boolean;
  zone?: string;
  draftPreview?: CalendarDraft | null;
}): EventInput[] {
  const entries = new Map(
    tasks.map((task) => [
      task.id,
      {
        task,
        zone,
        historical: false,
        date: undefined as string | undefined,
        groupColor: null as string | null,
      },
    ]),
  );
  for (const day of days) {
    for (const { task, groupColor } of day.entries) {
      if (day.finalized || !entries.has(task.id)) {
        entries.set(task.id, {
          task,
          groupColor,
          zone: day.finalized ? day.timezone : zone,
          historical: day.finalized,
          date: day.date,
        });
      }
    }
  }
  const hiddenTaskId =
    draftPreview &&
    (draftEvent(draftPreview, zone) || !draftPreview.draft.scheduledDate)
      ? draftPreview.taskId
      : undefined;
  return Array.from(entries.values()).flatMap(
    ({ task, historical, date, groupColor, zone: eventZone }) => {
      if (task.id === hiddenTaskId || !filter(task)) return [];
      const schedule = taskSchedule(task, eventZone);
      const startDate = historical ? date : schedule.scheduledDate || date;
      if (!startDate) return [];
      const start = schedule.startTime
        ? `${startDate}T${schedule.startTime}:00`
        : startDate;
      const end = schedule.endTime
        ? `${schedule.scheduledEndDate || startDate}T${schedule.endTime}:00`
        : undefined;
      return clockChangeSegments(
        {
          id: task.id,
          title: task.title,
          start,
          end,
          allDay: !schedule.startTime,
          editable: !disabled,
          classNames: [
            task.status === "complete" ? "event-complete" : "",
            historical ? "event-historical" : "",
          ],
          borderColor:
            groupColor ||
            groups.find((g) => g.id === task.groupId)?.color ||
            "#7391ba",
          extendedProps: { task, historical, zone: eventZone },
        },
        task,
        eventZone,
      );
    },
  );
}
