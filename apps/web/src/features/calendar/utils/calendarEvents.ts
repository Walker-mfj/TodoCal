import type { EventInput } from "@fullcalendar/core";
import type { Day, Group, Task } from "../../../shared/api/domainTypes";
import type { CalendarDraft } from "../types/calendarTypes";
import { draftEvent } from "./draftPreview";

export function calendarEvents({
  days,
  groups,
  filter,
  disabled,
  draftPreview,
}: {
  days: Day[];
  groups: Group[];
  filter: (task: Task) => boolean;
  disabled: boolean;
  draftPreview?: CalendarDraft | null;
}): EventInput[] {
  return days.flatMap((day) =>
    day.entries
      .filter(
        (e) =>
          filter(e.task) &&
          !(
            draftPreview?.taskId === e.task.id &&
            (draftEvent(draftPreview) || !draftPreview.draft.scheduledDate)
          ),
      )
      .map(({ task, groupColor }) => ({
        id: `${day.date}:${task.id}`,
        title: task.title,
        start: day.date + (task.startTime ? `T${task.startTime}:00` : ""),
        end: task.endTime ? `${day.date}T${task.endTime}:00` : undefined,
        allDay: !task.startTime,
        editable: !disabled,
        classNames: [
          task.status === "complete" ? "event-complete" : "",
          day.finalized ? "event-historical" : "",
        ],
        borderColor:
          groupColor ||
          groups.find((g) => g.id === task.groupId)?.color ||
          "#7391ba",
        extendedProps: { task, historical: day.finalized },
      })),
  );
}
