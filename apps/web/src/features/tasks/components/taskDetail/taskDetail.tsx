"use client";
import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./taskDetail.module.css";
const cx = bindStyles(styles);

import { PriorityBadge } from "../../../../shared/components/priorityBadge/priorityBadge";
import { Dialog } from "../../../../shared/components/dialog/dialog";
import { Repeat2 } from "lucide-react";
import { DateTime } from "luxon";
import { useState } from "react";
import { SidebarPanel } from "../../../../shared/components/sidebarPanel/sidebarPanel";
import { useOwnedQuery } from "../../../auth";
import { type Execute } from "../../../../shared/api/apiClient";
import { useCommand } from "../../../../shared/hooks/useCommand";
import { taskSchedule } from "../../../../shared/utils/taskSchedule";
import { dateLabel, today } from "../../../../shared/utils/dateUtils";
import { CompletionTimeForm } from "./completionTimeForm";
import {
  TaskRecurrenceDetails,
  TaskFocusHistory,
  type FocusHistory,
} from "./taskDetailSections";
import {
  type Task,
  type Group,
  type Day,
} from "../../../../shared/api/domainTypes";
import type { components } from "../../../../shared/api/apiTypes.generated";

export function TaskDetail({
  task,
  historical,
  groups,
  execute,
  disabled,
  onClose,
  onEdit,
  onComplete,
  onDeleted,
  onStopped,
  onFocus,
  zone = "UTC",
  defaultFocusMinutes = 25,
}: {
  task: Task;
  historical: boolean;
  groups: Group[];
  execute: Execute;
  disabled: boolean;
  onClose: () => void;
  onEdit: () => void;
  onCurrent: () => void;
  onComplete: (task: Task) => void;
  onDeleted: (task: Task) => void;
  onStopped?: (seriesId: string, stoppedRevision: number) => void;
  onFocus?: () => void;
  zone?: string;
  defaultFocusMinutes?: number;
}) {
  const [deleteChoice, setDeleteChoice] = useState(false);
  const deletionPreview = useOwnedQuery<
    components["schemas"]["FollowingDeletionPreview"]
  >(
    "following-deletion-preview",
    `/tasks/${task.id}/following-deletion-preview`,
    deleteChoice && !!task.seriesId,
  );
  const needsCompletedConfirmation =
    (deletionPreview.data?.completedCount ?? 0) > 0;
  const series = useOwnedQuery<components["schemas"]["RecurrenceSeries"]>(
    "series",
    `/series/${task.seriesId}`,
    !!task.seriesId,
  );
  const focus = useOwnedQuery<FocusHistory>(
    "task-focus",
    `/tasks/${task.id}/focus`,
  );
  const historicalDay = useOwnedQuery<Day>(
    "historical-day",
    `/reports/days/${task.scheduledDate}`,
    historical && !!task.scheduledDate,
  );
  const historicalEntry = historicalDay.data?.entries.find(
    (entry) => entry.task.id === task.id,
  );
  const scheduleZone = historical ? historicalDay.data?.timezone : zone;
  const schedule = taskSchedule(task, scheduleZone);
  const groupName = historical
    ? historicalDay.isPending
      ? "Loading…"
      : historicalDay.error
        ? "Unable to load historical group"
        : historicalEntry?.groupName || "No group"
    : groups.find((group) => group.id === task.groupId)?.name || "No group";
  const command = useCommand(execute);
  const [stopped, setStopped] = useState(false);
  const [confirmCompleted, setConfirmCompleted] = useState(false);
  const locked = disabled || command.busy || command.uncertain;
  const seriesZone = series.data?.timezone ?? zone;
  const stopDate = today(seriesZone);
  const timestamp = (value: string) =>
    DateTime.fromISO(value).setZone(zone).toFormat("MMM d, yyyy HH:mm");
  const remove = () => {
    setDeleteChoice(false);
    void command.run(
      `/tasks/${task.id}`,
      "DELETE",
      { expectedRevision: task.revision },
      () => onDeleted(task),
    );
  };
  const stop = () => {
    if (
      !task.seriesId ||
      !deletionPreview.data ||
      deletionPreview.isFetching ||
      deletionPreview.error
    )
      return;
    const seriesId = task.seriesId,
      revision = deletionPreview.data.seriesRevision;
    setDeleteChoice(false);
    void command.run(
      `/tasks/${task.id}`,
      "DELETE",
      {
        expectedRevision: task.revision,
        scope: "following",
        expectedSeriesRevision: revision,
        confirmCompleted: needsCompletedConfirmation && confirmCompleted,
      },
      () => {
        setStopped(true);
        onStopped?.(seriesId, revision + 1);
      },
    );
  };
  return (
    <SidebarPanel
      label={historical ? "Historical task details" : "Task details"}
      eyebrow={historical ? "HISTORICAL TASK" : "TASK DETAILS"}
      closeLabel="Close details"
      onClose={onClose}
      disabled={command.busy}
    >
      <PriorityBadge priority={task.priority} />
      <h2 className={cx("task-title")}>{task.title}</h2>
      <p className={cx("description")}>
        {task.description || "No description added."}
      </p>
      <dl>
        <dt>Status</dt>
        <dd>{task.status === "complete" ? "Complete" : "To do"}</dd>
        <dt>Group</dt>
        <dd>{groupName}</dd>
        <dt>Scheduled Time</dt>
        <dd>
          {schedule.scheduledDate
            ? dateLabel(schedule.scheduledDate)
            : "Unscheduled"}
          <br />
          {schedule.startTime ? (
            <>
              {schedule.startTime}–
              {schedule.scheduledEndDate &&
                schedule.scheduledEndDate !== schedule.scheduledDate &&
                `${dateLabel(schedule.scheduledEndDate)} · `}
              {schedule.endTime}
              {scheduleZone && ` · ${scheduleZone}`}
            </>
          ) : (
            "Untimed"
          )}
        </dd>
        <dt>Completed at</dt>
        <dd>
          {task.completedAt ? timestamp(task.completedAt) : "Not completed"}
        </dd>
        <dt>Planned Focus Time</dt>
        <dd>
          {task.estimatedPomodoros
            ? `${task.estimatedPomodoros} × ${task.focusMinutes || defaultFocusMinutes} min = ${task.estimatedPomodoros * (task.focusMinutes || defaultFocusMinutes)} min`
            : "No focus goal"}
        </dd>
        <dt>Actual Focus Time</dt>
        <dd>
          {focus.isPending
            ? "Loading…"
            : focus.error
              ? "Unable to load focus time"
              : `${Math.round(((focus.data?.actualFocusSeconds ?? task.actualFocusSeconds ?? 0) / 60) * 10) / 10} min`}
        </dd>
      </dl>
      <small>
        Scheduled time, planned focus and actual focus are separate. Focus
        progress does not complete the task.
      </small>
      {historical && (
        <p className={cx("notice")}>
          Changes update this day and its Analytics after saving.
        </p>
      )}
      <div className={cx("button-stack")}>
        <button
          className={cx("primary", true)}
          disabled={locked}
          onClick={() => onComplete(task)}
        >
          {task.status === "complete" ? "Mark incomplete" : "Mark complete"}
        </button>
        <button disabled={locked} onClick={onEdit} className={cx("", true)}>
          Edit task
        </button>
        {onFocus && (
          <button disabled={locked} onClick={onFocus} className={cx("", true)}>
            Focus on this task
          </button>
        )}
      </div>
      {task.status === "complete" && (
        <CompletionTimeForm
          task={task}
          zone={zone}
          locked={locked}
          onSave={(completedAt) =>
            void command.run(
              `/tasks/${task.id}/completion`,
              "POST",
              { complete: true, completedAt, expectedRevision: task.revision },
              onClose,
            )
          }
        />
      )}
      {task.seriesId && (
        <TaskRecurrenceDetails
          series={series}
          zone={zone}
          stopped={stopped}
          stopDate={stopDate}
        />
      )}
      <TaskFocusHistory focus={focus} zone={zone} />
      {command.error && (
        <p className={cx("error")} role="alert">
          {command.error}
        </p>
      )}
      <button
        className={cx("danger wide", true)}
        disabled={locked}
        onClick={() => {
          setConfirmCompleted(false);
          if (task.seriesId) setDeleteChoice(true);
          else remove();
        }}
      >
        Delete task
      </button>
      {command.uncertain && (
        <button
          disabled={command.busy}
          onClick={() => void command.run("", "", null)}
          className={cx("", true)}
        >
          Retry request
        </button>
      )}
      {deleteChoice && (
        <Dialog
          title="Delete repeating task"
          icon={Repeat2}
          onDismiss={() => setDeleteChoice(false)}
          description="Choose what to remove. Focus session history is retained."
          actions={
            <>
              <button
                className={cx("danger", true)}
                disabled={locked}
                onClick={remove}
              >
                Delete this occurrence
              </button>
              <button
                className={cx("danger", true)}
                disabled={
                  locked ||
                  !series.data ||
                  !!series.data.stoppedAfter ||
                  stopped ||
                  !deletionPreview.data ||
                  deletionPreview.isFetching ||
                  !!deletionPreview.error ||
                  (needsCompletedConfirmation && !confirmCompleted) ||
                  !task.originalOccurrenceDate ||
                  task.originalOccurrenceDate < stopDate
                }
                onClick={stop}
              >
                This and following
              </button>
            </>
          }
        >
          <p>
            Delete this occurrence removes only this task. Other dates stay
            unchanged.
          </p>
          <p>
            Delete this task and future repetitions starting{" "}
            {dateLabel(
              task.originalOccurrenceDate || task.scheduledDate || stopDate,
            )}{" "}
            ({seriesZone}). Earlier repetitions stay unchanged.
          </p>
          {deletionPreview.isFetching && (
            <p role="status">Checking affected occurrences…</p>
          )}
          {deletionPreview.error && (
            <p role="alert">
              Unable to check affected occurrences.{" "}
              <button onClick={() => void deletionPreview.refetch()}>
                Retry deletion preview
              </button>
            </p>
          )}
          {needsCompletedConfirmation && (
            <>
              <p>
                {deletionPreview.data?.completedCount} completed occurrence(s)
                will be hidden from the calendar. Their completion and Focus
                history are retained.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={confirmCompleted}
                  onChange={(event) =>
                    setConfirmCompleted(event.target.checked)
                  }
                />{" "}
                Include completed future occurrences, preserving their history
              </label>
            </>
          )}
          <p>
            Undo restores the whole deletion while its task and series revisions
            remain unchanged. Past original slots can only be deleted
            individually.
          </p>
          {series.error && (
            <p role="alert">
              Unable to load repeat details. Close and reopen to retry.
            </p>
          )}
        </Dialog>
      )}
    </SidebarPanel>
  );
}
