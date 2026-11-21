"use client";
import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./calendar.module.css";
const cx = bindStyles(styles);

import type { FocusView } from "../../../focus";
import { CalendarEventContent } from "../eventContent/eventContent";
import { priorityLabels } from "../../../../shared/constants/priorityLabels";
import { draftEvent, type CalendarDraft } from "../../utils/draftPreview";
import { DateTime } from "luxon";
import { useMemo, useEffect, useRef, useCallback, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { Schedule } from "../../utils/interactions";
import { calendarInteractions } from "../../utils/calendarInteractions";
import { calendarEvents } from "../../utils/calendarEvents";
import { initialCalendarScrollTime } from "../../utils/initialScrollTime";
import interactionPlugin from "@fullcalendar/interaction";
import {
  completionRatio,
  progressLevel,
} from "../../../../shared/utils/progress";
import {
  type Day,
  type Group,
  type Task,
} from "../../../../shared/api/domainTypes";
import type { CalendarSlot } from "../../types/calendarTypes";
export default function Calendar({
  draftPreview,
  draftDisabled = false,
  days,
  groups,
  today,
  timezone,
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
  focus: FocusView;
  defaultFocusMinutes: number;
  onOpenFocus: () => void;
  draftPreview?: CalendarDraft | null;
  draftDisabled?: boolean;
  days: Day[];
  groups: Group[];
  today: string;
  timezone: string;
  onRange: (from: string, to: string) => void;
  onTask: (task: Task, historical: boolean) => void;
  onCreate: (seed: CalendarSlot) => void;
  filter: (task: Task) => boolean;
  disabled: boolean;
  onSchedule: (task: Task, schedule: Schedule) => void;
  onScheduleError: (error: unknown) => void;
  onDay?: (date: string) => void;
}) {
  const timezoneRef = useRef(timezone);
  timezoneRef.current = timezone;
  const currentTime = useCallback(
    () =>
      DateTime.now()
        .setZone(timezoneRef.current)
        .toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'"),
    [],
  );
  // Capture the account-local time once when Calendar opens, not on every render.
  const [initialScrollTime] = useState(() => initialCalendarScrollTime(timezone));
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
  const events = useMemo(
    () => calendarEvents({ days, groups, filter, disabled, draftPreview }),
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
        className={cx(
          `calendar-progress ${progressLevel(completionRatio(day))}`,
          true,
        )}
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
    <div className={cx("calendar-wrap")} ref={containerRef}>
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        initialDate={today}
        now={currentTime}
        nowIndicator
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
        scrollTime={initialScrollTime}
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
        {...calendarInteractions({
          draftPreview,
          disabled,
          draftDisabled,
          onCreate,
          onSchedule,
          onScheduleError,
        })}
        events={preview ? [...events, preview] : events}
        datesSet={(arg) =>
          onRange(arg.startStr.slice(0, 10), arg.endStr.slice(0, 10))
        }
        eventClick={(arg) => {
          if ((arg.jsEvent.target as HTMLElement).closest(".quick-focus"))
            return;
          const task = arg.event.extendedProps.task as Task | undefined;
          if (task) onTask(task, Boolean(arg.event.extendedProps.historical));
        }}
        eventContent={(arg) => (
          <CalendarEventContent
            accessibleLabel={
              arg.event.extendedProps.draft
                ? `Unsaved draft: ${arg.event.title}, ${arg.event.startStr}`
                : arg.event.extendedProps.task && !arg.isMirror
                  ? `${arg.event.title}, ${priorityLabels[arg.event.extendedProps.task.priority as Task["priority"]]} priority, ${arg.event.extendedProps.task.status === "complete" ? "Completed" : "To do"}, ${arg.event.startStr}`
                  : undefined
            }
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
