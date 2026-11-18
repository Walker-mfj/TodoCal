"use client";
import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./eventContent.module.css";
const cx = bindStyles(styles);

import { useState, useLayoutEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Pause, Play, Repeat2 } from "lucide-react";
import { PriorityBadge } from "../../../../shared/components/priorityBadge/priorityBadge";
import type { Task } from "../../../../shared/api/domainTypes";
import type { FocusView } from "../../../focus";
import { useRemaining } from "../../../focus";

type CardTask = Task & {
  focusMinutes?: number | null;
  actualFocusSeconds?: number;
  recurrenceCadence?: string | null;
  recurrenceIntervalDays?: number | null;
};
export function CalendarEventContent({
  title,
  accessibleLabel,
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
  accessibleLabel?: string;
  timeText: string;
  priority?: Task["priority"];
  compact: boolean;
  complete: boolean;
  draft: boolean;
  repeating: boolean;
  task?: CardTask;
  focus?: FocusView;
  defaultFocusMinutes?: number;
  onOpenFocus?: () => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (accessibleLabel)
      content.current
        ?.closest(".fc-event")
        ?.setAttribute("aria-label", accessibleLabel);
  }, [accessibleLabel]);
  const [conflict, setConflict] = useState(false);
  const minutes = task?.focusMinutes || defaultFocusMinutes;
  const actual = task?.actualFocusSeconds || 0;
  const planned = task?.estimatedPomodoros || 0;
  const active = focus?.active;
  const own = !!task && active?.taskId === task.id && active.kind === "focus";
  // Only the event that owns the running session ticks; every other
  // event passes null here and stays static.
  const remaining = useRemaining(own ? active : null, focus?.receivedAt ?? 0);
  const units =
    (task?.focusProgress ?? actual / (minutes * 60)) +
    (own
      ? Math.max(0, active.targetSeconds - remaining) / active.targetSeconds
      : 0);
  const count = Math.max(planned, Math.ceil(units));
  const label = `${Math.round(actual / 60)}${planned ? ` / ${planned * minutes}` : ""} min focus`;
  const canStart = !!task && task.status !== "complete" && !draft;
  const action = own
    ? active.status === "paused"
      ? "Resume"
      : "Pause"
    : "Start";
  const time = `${Math.floor(remaining / 60)
    .toString()
    .padStart(2, "0")}:${(remaining % 60).toString().padStart(2, "0")}`;
  const recurrence =
    task?.recurrenceCadence === "daily"
      ? "Daily"
      : task?.recurrenceCadence === "weekly"
        ? "Weekly"
        : task?.recurrenceIntervalDays
          ? `Every ${task.recurrenceIntervalDays}d`
          : "Repeating";
  const repeatIndicator = repeating && (
    <span
      className={cx("event-repeat")}
      aria-label={recurrence}
      title={recurrence}
    >
      <Repeat2 size={12} aria-hidden="true" />
      {!compact && <span>{recurrence}</span>}
    </span>
  );
  const stop = (event: { stopPropagation: () => void }) =>
    event.stopPropagation();
  return (
    <>
      <div
        ref={content}
        className={cx(
          `event-content calendar-task-content focus-card${compact ? " compact" : ""}${own ? " focus-active" : ""}${focus && canStart ? " focus-available" : ""}`,
        )}
        title={`${timeText} ${title}`}
      >
        <div className={cx("focus-card-main")}>
          {priority && <PriorityBadge priority={priority} compact />}
          <span className={cx("event-title")}>
            {complete && (
              <span className={cx("event-done")} aria-label="Completed">
                ✓{" "}
              </span>
            )}
            {title}
          </span>
          {count > 0 && (
            <span
              className={cx("focus-clocks")}
              aria-label={label}
              title={label}
            >
              {Array.from({ length: Math.min(5, count) }, (_, i) => {
                const fill = Math.min(1, Math.max(0, units - i));
                return (
                  <span
                    key={i}
                    className={cx("focus-stopwatch")}
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
                <small
                  className={cx("focus-clock-overflow")}
                  aria-hidden="true"
                >
                  +{count - 5}
                </small>
              )}
              {count > 1 && (
                <small
                  className={cx("focus-clock-narrow-count")}
                  aria-hidden="true"
                >
                  +{count - 1}
                </small>
              )}
            </span>
          )}
          {draft && <span className={cx("draft-badge")}>Draft</span>}
        </div>
        {compact ? (
          repeatIndicator
        ) : (
          <div className={cx("focus-card-footer")}>
            <span className={cx("focus-card-time")}>
              {own ? time : timeText}
            </span>
            {!own && count > 0 && (
              <span className={cx("focus-card-focus-label")}>· {label}</span>
            )}
            {repeatIndicator}
          </div>
        )}
        {focus && (own || canStart) && (
          <div
            className={cx("quick-focus fc-event-no-drag")}
            onPointerDownCapture={(event) => {
              // Preserve the action target instead of letting the enclosing
              // calendar anchor take pointer focus or initiate a native drag.
              event.preventDefault();
              event.stopPropagation();
              (event.target as Element).closest("button")?.focus();
            }}
            onMouseDownCapture={stop}
            onTouchStartCapture={stop}
            onClick={stop}
            onKeyDown={stop}
            onKeyUp={stop}
          >
            {own && compact && (
              <span className={cx("quick-focus-time")}>{time}</span>
            )}
            <button
              type="button"
              disabled={focus.blocked}
              aria-label={`${action} focus for ${title}${own ? "" : ` · ${minutes} min`}`}
              title={`${action} focus${own ? "" : ` · ${minutes} min`}`}
              onClick={() => {
                if (own) {
                  focus.change(active.status === "paused" ? "resume" : "pause");
                  if (active.status === "paused") onOpenFocus?.();
                } else if (active) setConflict(true);
                else if (task) {
                  focus.start("focus", task.id, minutes);
                  onOpenFocus?.();
                }
              }}
              className={cx("", true)}
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
            className={cx("calendar-focus-notice")}
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
              className={cx("", true)}
            >
              Open current timer
            </button>
            <button
              type="button"
              onClick={() => setConflict(false)}
              className={cx("", true)}
            >
              Dismiss
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
