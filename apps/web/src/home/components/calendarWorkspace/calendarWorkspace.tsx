"use client";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { ProgressLegend } from "../../../features/calendar";
import { TaskRow } from "../../../features/tasks";
import { ToastNotice } from "../../../shared/components/toast/toast";
import { errorMessage } from "../../../shared/api/apiClient";
import type {
  CalendarRange,
  Group,
  Task,
} from "../../../shared/api/domainTypes";
import { bindStyles } from "../../../shared/utils/classNames";
import styles from "./calendarWorkspace.module.css";
const cx = bindStyles(styles);

export function CalendarWorkspace({
  children,
  calendar,
  unscheduled,
  unscheduledOpen,
  setUnscheduledOpen,
  allGroups,
  filter,
  taskActionsDisabled,
  complete,
  onTask,
  onCreate,
  onViewAll,
}: {
  children: ReactNode;
  calendar: {
    error: unknown;
    refetch: () => Promise<unknown>;
    data?: CalendarRange;
  };
  unscheduled: { error: unknown; data?: { items: Task[] } };
  unscheduledOpen: boolean;
  setUnscheduledOpen: (open: boolean) => void;
  allGroups: Group[];
  filter: (task: Task) => boolean;
  taskActionsDisabled: boolean;
  complete: (task: Task) => void;
  onTask: (task: Task) => void;
  onCreate: () => void;
  onViewAll: () => void;
}) {
  return (
    <>
      <div className={cx("calendar-card")}>
        {calendar.error ? (
          <p className={cx("error")} role="alert">
            {errorMessage(calendar.error)}
            <button
              onClick={() => void calendar.refetch()}
              className={cx("", true)}
            >
              Retry calendar
            </button>
          </p>
        ) : null}
        {children}
        <ProgressLegend />
      </div>
      {!!calendar.data?.warnings.length && (
        <ToastNotice tone="warning">
          Some repeating tasks fall in a daylight-saving time gap and were
          skipped: {calendar.data.warnings.map((w) => w.date).join(", ")}.
        </ToastNotice>
      )}
      <details
        className={cx("unscheduled-section")}
        open={unscheduledOpen}
        onToggle={(event) => setUnscheduledOpen(event.currentTarget.open)}
      >
        <summary>
          Without a date <span>{unscheduled.data?.items.length || 0}</span>
        </summary>
        <div className={cx("unscheduled-content")}>
          <div className={cx("section-title")}>
            <h2>Without a date</h2>
            <button className={cx("text-button", true)} onClick={onViewAll}>
              View all <ArrowUpRight size={14} />
            </button>
          </div>
          <p className={cx("muted")}>
            Keep an idea here until you’re ready to make room.
          </p>
          {unscheduled.error ? (
            <p className={cx("error")}>{errorMessage(unscheduled.error)}</p>
          ) : unscheduled.data?.items.length ? (
            unscheduled.data.items
              .filter(filter)
              .map((t) => (
                <TaskRow
                  draggable
                  key={t.id}
                  task={t}
                  groups={allGroups}
                  disabled={taskActionsDisabled}
                  onComplete={complete}
                  onOpen={() => onTask(t)}
                />
              ))
          ) : (
            <button className={cx("empty-add", true)} onClick={onCreate}>
              + Capture a task, no date needed
            </button>
          )}
        </div>
      </details>
    </>
  );
}
