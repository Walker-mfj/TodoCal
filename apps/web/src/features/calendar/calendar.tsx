"use client";
import type { FocusController } from "../focus/useFocus";
import { CalendarEventContent } from "./event-content";
import "./event-content.css";
import { priorityLabels } from "../../components/priority-badge";
import { draftEvent, type CalendarDraft } from "./draft-preview";
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
  draftPreview,
  draftDisabled = false,
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
  focus,
  defaultFocusMinutes,
  onOpenFocus,
}: {
  focus: FocusController;
  defaultFocusMinutes: number;
  onOpenFocus: () => void;
  draftPreview?: CalendarDraft | null;
  draftDisabled?: boolean;
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
  // Recalculate widths when the navigation or editor changes the available space.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() =>
      calendarRef.current?.getApi().updateSize(),
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);
  const preview = draftEvent(draftPreview);
  if (preview) preview.editable = !disabled && !draftDisabled;
  const moveDraft = (
    start: string,
    end: string | undefined,
    allDay: boolean,
    kind: "move" | "resize" | "month",
  ) => {
    if (!draftPreview || disabled || draftDisabled) return;
    const schedule = scheduleFromDrop(
      {
        startTime: draftPreview.draft.startTime || null,
        endTime: draftPreview.draft.endTime || null,
      },
      start,
      end,
      allDay,
      kind,
    );
    onCreate({
      scheduledDate: schedule.scheduledDate || "",
      startTime: schedule.startTime || "",
      endTime: schedule.endTime || "",
    });
  };
  const events = useMemo(
    () =>
      days.flatMap((day) =>
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
      ),
    [days, groups, filter, disabled, draftPreview],
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
    <div className="calendar-wrap" ref={containerRef}>
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
        height="100%"
        scrollTimeReset={false}
        scrollTime="08:00:00"
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        slotDuration="00:30:00"
        slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        dayMaxEvents={3}
        slotEventOverlap={false}
        eventMinHeight={16}
        eventShortHeight={32}
        selectable={!disabled}
        selectMirror
        // A click uses the 30-minute dateClick default; only dragging selects.
        selectMinDistance={5}
        editable={!disabled}
        droppable={!disabled}
        eventResizableFromStart
        snapDuration="00:15:00"
        eventDrop={(arg) => {
          try {
            if (arg.oldEvent.extendedProps.draft) {
              const { startStr, endStr, allDay } = arg.event;
              arg.revert();
              moveDraft(
                startStr,
                endStr || undefined,
                allDay,
                arg.view.type === "dayGridMonth" ? "month" : "move",
              );
              return;
            }
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
            if (arg.oldEvent.extendedProps.draft) {
              const { startStr, endStr, allDay } = arg.event;
              arg.revert();
              moveDraft(startStr, endStr || undefined, allDay, "resize");
              return;
            }
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
        events={preview ? [...events, preview] : events}
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
          if ((arg.jsEvent.target as HTMLElement).closest(".quick-focus"))
            return;
          const task = arg.event.extendedProps.task as Task | undefined;
          if (task) onTask(task, Boolean(arg.event.extendedProps.historical));
        }}
        eventContent={(arg) => (
          <CalendarEventContent
            task={arg.event.extendedProps.task}
            focus={focus}
            defaultFocusMinutes={defaultFocusMinutes}
            onOpenFocus={onOpenFocus}
            title={arg.event.title}
            timeText={arg.timeText}
            priority={
              arg.event.extendedProps.task?.priority ??
              (arg.event.extendedProps.draft
                ? (arg.event.extendedProps.priority ?? "medium")
                : undefined)
            }
            compact={
              arg.event.allDay ||
              arg.view.type === "dayGridMonth" ||
              Boolean(
                arg.event.start &&
                arg.event.end &&
                +arg.event.end - +arg.event.start <= 1800000,
              )
            }
            complete={arg.event.extendedProps.task?.status === "complete"}
            draft={Boolean(arg.event.extendedProps.draft)}
            repeating={Boolean(arg.event.extendedProps.task?.seriesId)}
          />
        )}
        eventDidMount={(arg) => {
          if (arg.event.extendedProps.draft) {
            arg.el.setAttribute("role", "note");
            arg.el.setAttribute(
              "aria-label",
              `Unsaved draft: ${arg.event.title}, ${arg.event.startStr}`,
            );
            return;
          }
          // Selection mirrors are synthetic events with no persisted task.
          // Drag/resize mirrors must not become duplicate keyboard controls.
          if (arg.isMirror || !arg.event.extendedProps.task) return;
          arg.el.setAttribute("tabindex", "0");
          arg.el.setAttribute("role", "button");
          arg.el.setAttribute(
            "aria-label",
            `${arg.event.title}, ${priorityLabels[arg.event.extendedProps.task.priority as Task["priority"]]} priority, ${arg.event.extendedProps.task.status === "complete" ? "Completed" : "To do"}, ${arg.event.startStr}`,
          );
          arg.el.onkeydown = (e) => {
            if (e.target !== arg.el) return;
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
