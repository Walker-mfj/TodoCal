"use client";
import { useMemo, useEffect, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import { scheduleFromDrop, type Schedule } from "./interactions";
import interactionPlugin from "@fullcalendar/interaction";
import {
  slotDraft,
  completionRatio,
  progressLevel,
  type Day,
  type Group,
  type Task,
  type Draft,
} from "../../lib/model";
export default function Calendar({
  reveal,
  days,
  groups,
  today,
  onRange,
  onTask,
  onCreate,
  filter,
  disabled,
  onSchedule,
  onScheduleError,
  onDay,
}: {
  reveal?: Partial<Draft> | null;
  days: Day[];
  groups: Group[];
  today: string;
  onRange: (from: string, to: string) => void;
  onTask: (task: Task, historical: boolean) => void;
  onCreate: (seed: Partial<Draft>) => void;
  filter: (task: Task) => boolean;
  disabled: boolean;
  onSchedule: (task: Task, schedule: Schedule) => void;
  onScheduleError: (error: unknown) => void;
  onDay?: (date: string) => void;
}) {
  const calendarRef = useRef<FullCalendar>(null);
  useEffect(() => {
    if (!reveal?.scheduledDate) return;
    const api = calendarRef.current?.getApi();
    api?.gotoDate(reveal.scheduledDate);
    if (reveal.startTime) api?.scrollToTime(reveal.startTime);
  }, [reveal]);
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
            editable: !day.finalized && !disabled,
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
    [days, groups, filter, disabled],
  );
  const progress = (date: string) => {
    const day = days.find((d) => d.date === date);
    if (!day) return null;
    const label =
      day.percentage === null
        ? date > today
          ? "Upcoming"
          : "No plan"
        : `${day.percentage === 100 ? "✓ " : ""}${day.percentage}% · ${day.completed}/${day.planned}`;
    return (
      <button
        className={`calendar-progress ${progressLevel(completionRatio(day))}`}
        aria-label={`${label}, daily progress ${date}`}
        onClick={(event) => {
          event.stopPropagation();
          onDay?.(date);
        }}
      >
        {day.percentage === null
          ? date > today
            ? "Upcoming"
            : "No plan"
          : `${day.percentage === 100 ? "✓ " : ""}${day.percentage}% · ${day.completed}/${day.planned}`}
      </button>
    );
  };
  return (
    <div className="calendar-wrap">
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        initialDate={today}
        now={today + "T12:00:00Z"}
        timeZone="UTC"
        firstDay={1}
        dayHeaderContent={(arg) => (
          <div>
            {arg.text}
            {arg.view.type !== "dayGridMonth" &&
              progress(arg.date.toISOString().slice(0, 10))}
          </div>
        )}
        dayCellContent={(arg) => (
          <div>
            {arg.dayNumberText}
            {arg.view.type === "dayGridMonth" &&
              progress(arg.date.toISOString().slice(0, 10))}
          </div>
        )}
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "timeGridDay,timeGridWeek,dayGridMonth",
        }}
        buttonIcons={false}
        buttonText={{
          prev: "Previous",
          next: "Next",
          today: "Today",
          day: "Day",
          week: "Week",
          month: "Month",
        }}
        dayCellDidMount={({ el, date, view }) => {
          if (view.type.startsWith("timeGrid")) {
            el.tabIndex = 0;
            el.setAttribute(
              "aria-label",
              `Time slots for ${date.toISOString().slice(0, 10)}`,
            );
          }
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
        slotEventOverlap={false}
        selectable={!disabled}
        selectMirror
        // A click uses the 30-minute dateClick default; only dragging selects.
        selectMinDistance={5}
        editable={!disabled}
        droppable={!disabled}
        eventResizableFromStart
        snapDuration="00:15:00"
        eventAllow={(info) =>
          info.startStr.slice(0, 10) >= today &&
          !days.find((day) => day.date === info.startStr.slice(0, 10))
            ?.finalized
        }
        eventDrop={(arg) => {
          try {
            const task = arg.oldEvent.extendedProps.task as Task;
            const schedule = scheduleFromDrop(
              task,
              arg.event.startStr,
              arg.event.endStr || undefined,
              arg.event.allDay,
              arg.view.type === "dayGridMonth" ? "month" : "move",
            );
            arg.revert();
            onSchedule(task, schedule);
          } catch (error) {
            arg.revert();
            onScheduleError(error);
          }
        }}
        eventResize={(arg) => {
          try {
            const task = arg.oldEvent.extendedProps.task as Task;
            const schedule = scheduleFromDrop(
              task,
              arg.event.startStr,
              arg.event.endStr || undefined,
              arg.event.allDay,
              "resize",
            );
            arg.revert();
            onSchedule(task, schedule);
          } catch (error) {
            arg.revert();
            onScheduleError(error);
          }
        }}
        eventReceive={(arg) => {
          try {
            const task = arg.event.extendedProps.task as Task;
            const schedule = scheduleFromDrop(
              task,
              arg.event.startStr,
              arg.event.endStr || undefined,
              arg.event.allDay,
              arg.view.type === "dayGridMonth" ? "month" : "move",
            );
            arg.revert();
            onSchedule(task, schedule);
          } catch (error) {
            arg.revert();
            onScheduleError(error);
          }
        }}
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
        eventClick={(arg) => {
          const task = arg.event.extendedProps.task as Task | undefined;
          if (task) onTask(task, Boolean(arg.event.extendedProps.historical));
        }}
        eventContent={(arg) => (
          <div
            className={`event-content ${arg.event.start && arg.event.end && +arg.event.end - +arg.event.start <= 1800000 ? "compact" : ""}`}
            title={`${arg.timeText} ${arg.event.title}`}
          >
            <span className="event-time">
              {arg.event.extendedProps.task?.status === "complete" ? "✓ " : ""}
              {arg.timeText}
              {arg.event.extendedProps.task?.priority === "high" ? " · !" : ""}
            </span>
            <span>{arg.event.title}</span>
            {arg.event.extendedProps.task?.seriesId && (
              <span className="event-repeat" aria-label="Repeating">
                ↻
              </span>
            )}
          </div>
        )}
        eventDidMount={(arg) => {
          // Selection mirrors are synthetic events with no persisted task.
          // Drag/resize mirrors must not become duplicate keyboard controls.
          if (arg.isMirror || !arg.event.extendedProps.task) return;
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
