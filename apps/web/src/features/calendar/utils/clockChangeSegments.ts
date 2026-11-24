import { DateTime } from "luxon";
import type { EventInput } from "@fullcalendar/core";
import type { Task } from "../../../shared/api/domainTypes";

// A wall-clock grid has only one row for a repeated hour. Split a same-day
// interval into the two offset-labelled passes instead of letting FullCalendar
// replace its nonpositive wall duration with a default hour. Both open one task;
// edit its full interval in the editor rather than dragging a partial segment.
export function clockChangeSegments(
  event: EventInput,
  task: Task,
  zone: string,
): EventInput[] {
  if (!task.scheduledStartAt || !task.scheduledEndAt || !event.end)
    return [event];
  const start = DateTime.fromISO(task.scheduledStartAt, { zone });
  const end = DateTime.fromISO(task.scheduledEndAt, { zone });
  if (
    !start.isValid ||
    !end.isValid ||
    end <= start ||
    start.offset <= end.offset ||
    start.toISODate() !== end.toISODate()
  )
    return [event];
  let low = start.toMillis(),
    high = end.toMillis();
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (DateTime.fromMillis(middle, { zone }).offset === start.offset)
      low = middle;
    else high = middle;
  }
  const wall = (value: DateTime) => value.toFormat("yyyy-MM-dd'T'HH:mm:ss");
  const firstEnd = DateTime.fromISO(
    DateTime.fromMillis(high - 1, { zone }).toFormat(
      "yyyy-MM-dd'T'HH:mm:ss.SSS",
    ),
    { zone: "UTC" },
  ).plus({ milliseconds: 1 });
  const secondStart = DateTime.fromMillis(high, { zone });
  return [
    {
      ...event,
      id: `${event.id}:before-clock-change`,
      title: `${event.title} (UTC${start.toFormat("ZZ")})`,
      start: wall(start),
      end: wall(firstEnd),
      editable: false,
    },
    {
      ...event,
      id: `${event.id}:after-clock-change`,
      title: `${event.title} (UTC${end.toFormat("ZZ")})`,
      start: wall(secondStart),
      end: wall(end),
      editable: false,
    },
  ].filter((segment) => String(segment.end) > String(segment.start));
}
