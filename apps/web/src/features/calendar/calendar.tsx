"use client";
import { useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import {
  slotDraft,
  type Day,
  type Group,
  type Task,
  type Draft,
} from "../../lib/model";
export default function Calendar({
  days,
  groups,
  today,
  onRange,
  onTask,
  onCreate,
  filter,
  disabled,
}: {
  days: Day[];
  groups: Group[];
  today: string;
  onRange: (from: string, to: string) => void;
  onTask: (task: Task, historical: boolean) => void;
  onCreate: (seed: Partial<Draft>) => void;
  filter: (task: Task) => boolean;
  disabled: boolean;
}) {
  const events = useMemo(
    () =>
      days.flatMap((day) =>
        day.entries
          .filter((e) => filter(e.task))
          .map(({ task, groupColor }) => ({
            id: `${day.date}:${task.id}`,
            title: task.title,
            start: day.date + (task.startTime ? `T${task.startTime}:00` : ""),
            end: task.endTime ? `${day.date}T${task.endTime}:00` : undefined,
            allDay: !task.startTime,
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
      ),
    [days, groups, filter],
  );
  return (
    <div className="calendar-wrap">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        initialDate={today}
        now={today + "T12:00:00Z"}
        timeZone="UTC"
        firstDay={1}
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "timeGridDay,timeGridWeek,dayGridMonth",
        }}
        buttonText={{
          today: "Today",
          day: "Day",
          week: "Week",
          month: "Month",
        }}
        allDayText="Untimed"
        height={650}
        scrollTime="08:00:00"
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        slotDuration="00:30:00"
        slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        dayMaxEvents={3}
        selectable={!disabled}
        selectMirror
        editable={false}
        events={events}
        datesSet={(arg) =>
          onRange(arg.startStr.slice(0, 10), arg.endStr.slice(0, 10))
        }
        dateClick={(arg) => {
          if (!disabled)
            onCreate(slotDraft(arg.dateStr, undefined, arg.allDay));
        }}
        select={(arg) => {
          if (
            !disabled &&
            (arg.allDay ||
              arg.startStr.slice(0, 10) === arg.endStr.slice(0, 10))
          )
            onCreate(slotDraft(arg.startStr, arg.endStr, arg.allDay));
          arg.view.calendar.unselect();
        }}
        eventClick={(arg) =>
          onTask(
            arg.event.extendedProps.task,
            arg.event.extendedProps.historical,
          )
        }
        eventContent={(arg) => (
          <div
            className={`event-content ${arg.event.start && arg.event.end && +arg.event.end - +arg.event.start <= 1800000 ? "compact" : ""}`}
            title={`${arg.timeText} ${arg.event.title}`}
          >
            <span className="event-time">
              {arg.event.extendedProps.task.status === "complete" ? "✓ " : ""}
              {arg.timeText}
              {arg.event.extendedProps.task.priority === "high" ? " · !" : ""}
            </span>
            <span>{arg.event.title}</span>
            {arg.event.extendedProps.task.seriesId && (
              <span className="event-repeat" aria-label="Repeating">
                ↻
              </span>
            )}
          </div>
        )}
        eventDidMount={(arg) => {
          arg.el.setAttribute("tabindex", "0");
          arg.el.setAttribute("role", "button");
          arg.el.setAttribute(
            "aria-label",
            `${arg.event.title}, ${arg.event.startStr}`,
          );
          arg.el.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onTask(
                arg.event.extendedProps.task,
                arg.event.extendedProps.historical,
              );
            }
          };
        }}
      />
    </div>
  );
}
