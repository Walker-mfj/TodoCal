"use client";
import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Pause, Play, Repeat2 } from "lucide-react";
import { PriorityBadge } from "../../components/priority-badge";
import type { Task } from "../../lib/model";
import type { FocusController } from "../focus/useFocus";

type CardTask = Task & {
  focusMinutes?: number | null;
  actualFocusSeconds?: number;
  recurrenceCadence?: string | null;
  recurrenceIntervalDays?: number | null;
};
export function CalendarEventContent({
  title,
  timeText,
  priority,
  compact,
  complete,
  draft,
  repeating,
  task,
  focus,
  defaultFocusMinutes = 25,
  onOpenFocus,
}: {
  title: string;
  timeText: string;
  priority?: Task["priority"];
  compact: boolean;
  complete: boolean;
  draft: boolean;
  repeating: boolean;
  task?: CardTask;
  focus?: FocusController;
  defaultFocusMinutes?: number;
  onOpenFocus?: () => void;
}) {
  const [conflict, setConflict] = useState(false);
  const minutes = task?.focusMinutes || defaultFocusMinutes;
  const actual = task?.actualFocusSeconds || 0;
  const planned = task?.estimatedPomodoros || 0;
  const active = focus?.active;
  const own = !!task && active?.taskId === task.id && active.kind === "focus";
  const units =
    (task?.focusProgress ?? actual / (minutes * 60)) +
    (own
      ? Math.max(0, active.targetSeconds - (focus?.remaining ?? 0)) /
        active.targetSeconds
      : 0);
  const count = Math.max(planned, Math.ceil(units));
  const label = `${Math.round(actual / 60)}${planned ? ` / ${planned * minutes}` : ""} min focus`;
  const canStart = !!task && task.status !== "complete" && !draft;
  const action = own
    ? active.status === "paused"
      ? "Resume"
      : "Pause"
    : "Start";
  const time = `${Math.floor((focus?.remaining || 0) / 60)
    .toString()
    .padStart(
      2,
      "0",
    )}:${((focus?.remaining || 0) % 60).toString().padStart(2, "0")}`;
  const recurrence =
    task?.recurrenceCadence === "daily"
      ? "Daily"
      : task?.recurrenceCadence === "weekly"
        ? "Weekly"
        : task?.recurrenceIntervalDays
          ? `Every ${task.recurrenceIntervalDays}d`
          : "Repeating";
  const stop = (event: { stopPropagation: () => void }) =>
    event.stopPropagation();
  return (
    <>
      <div
        className={`event-content calendar-task-content focus-card${compact ? " compact" : ""}${own ? " focus-active" : ""}${focus && canStart ? " focus-available" : ""}`}
        title={`${timeText} ${title}`}
      >
        <div className="focus-card-main">
          {priority && <PriorityBadge priority={priority} compact={compact} />}
          <span className="event-title">
            {complete && (
              <span className="event-done" aria-label="Completed">
                ✓{" "}
              </span>
            )}
            {title}
          </span>
          {count > 0 && (
            <span className="focus-clocks" aria-label={label} title={label}>
              {Array.from({ length: Math.min(5, count) }, (_, i) => {
                const fill = Math.min(1, Math.max(0, units - i));
                return (
                  <span
                    key={i}
                    className="focus-stopwatch"
                    data-fill={fill}
                    aria-hidden="true"
                  >
                    <span
                      style={
                        {
                          "--clock-fill": `${fill * 360}deg`,
                          "--clock-hand": fill > 0.5 ? "#fff" : "currentColor",
                        } as CSSProperties
                      }
                    />
                  </span>
                );
              })}
              {count > 5 && (
                <small className="focus-clock-overflow" aria-hidden="true">
                  +{count - 5}
                </small>
              )}
              {count > 1 && (
                <small className="focus-clock-narrow-count" aria-hidden="true">
                  +{count - 1}
                </small>
              )}
            </span>
          )}
          {draft && <span className="draft-badge">Draft</span>}
        </div>
        {!compact && (
          <div className="focus-card-footer">
            <span>
              {own ? time : timeText}
              {!own && count > 0 ? ` · ${label}` : ""}
            </span>
          </div>
        )}
        {repeating && (
          <span
            className="event-repeat"
            aria-label={recurrence}
            title={recurrence}
          >
            <Repeat2 size={12} aria-hidden="true" />
            {!compact && <span>{recurrence}</span>}
          </span>
        )}
        {focus && (own || canStart) && (
          <div
            className="quick-focus fc-event-no-drag"
            onPointerDownCapture={stop}
            onMouseDownCapture={stop}
            onTouchStartCapture={stop}
            onClick={stop}
            onKeyDown={stop}
            onKeyUp={stop}
          >
            {own && compact && <span className="quick-focus-time">{time}</span>}
            <button
              type="button"
              disabled={focus.blocked}
              aria-label={`${action} focus for ${title}${own ? "" : ` · ${minutes} min`}`}
              title={`${action} focus${own ? "" : ` · ${minutes} min`}`}
              onClick={() => {
                if (own)
                  focus.change(active.status === "paused" ? "resume" : "pause");
                else if (active) setConflict(true);
                else if (task) focus.start("focus", task.id, minutes);
              }}
            >
              {own && active.status === "running" ? (
                <Pause size={13} aria-hidden="true" />
              ) : (
                <Play size={13} aria-hidden="true" />
              )}
            </button>
          </div>
        )}
      </div>
      {conflict &&
        createPortal(
          <div
            className="calendar-focus-notice"
            role="alert"
            onClick={stop}
            onPointerDown={stop}
            onKeyDown={stop}
          >
            <span>
              End the current session for{" "}
              {active?.taskTitle ||
                (active?.kind === "focus" ? "Free focus" : "Break")}{" "}
              before starting another task.
            </span>
            <button
              type="button"
              onClick={() => {
                onOpenFocus?.();
                setConflict(false);
              }}
            >
              Open current timer
            </button>
            <button type="button" onClick={() => setConflict(false)}>
              Dismiss
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
