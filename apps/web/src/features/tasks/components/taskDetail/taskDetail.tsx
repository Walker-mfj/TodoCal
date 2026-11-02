"use client";
import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./taskDetail.module.css";
const cx = bindStyles(styles);

import { PriorityBadge } from "../priorityBadge/priorityBadge";
import { Dialog } from "../../../../shared/components/dialog/dialog";
import { Repeat2 } from "lucide-react";
import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import { SidebarPanel } from "../../../../shared/components/sidebarPanel/sidebarPanel";
import { useOwnedQuery } from "../../../auth/hooks/useOwnedQuery";
import { type Execute } from "../../../../shared/api/apiClient";
import { useCommand } from "../../../../shared/hooks/useCommand";
import { dateLabel, today } from "../../../../shared/utils/dateUtils";
import { recurrenceSummary } from "../../utils/recurrenceSummary";
import {
  type Task,
  type Group,
  type Day,
} from "../../../../shared/api/domainTypes";
import type { components } from "../../../../shared/api/apiTypes.generated";

type FocusHistory = {
  actualFocusSeconds: number;
  sessions: components["schemas"]["FocusSession"][];
};
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
  const [completionError, setCompletionError] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  useEffect(() => {
    setCompletedAt(
      task.completedAt
        ? DateTime.fromISO(task.completedAt)
            .setZone(zone)
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : "",
    );
  }, [task.completedAt, zone]);
  const locked = disabled || command.busy || command.uncertain;
  const stopDate = today(zone);
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
          {task.scheduledDate ? dateLabel(task.scheduledDate) : "Unscheduled"}
          <br />
          {task.startTime
            ? `${task.startTime}–${task.endTime}`
            : "Untimed"} · {zone}
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
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = DateTime.fromISO(completedAt, { zone });
            if (
              !value.isValid ||
              value.toFormat("yyyy-MM-dd'T'HH:mm") !== completedAt
            ) {
              setCompletionError("Enter a valid completion time.");
              return;
            }
            setCompletionError("");
            void command.run(
              `/tasks/${task.id}/completion`,
              "POST",
              {
                complete: true,
                completedAt: value.toUTC().toISO(),
                expectedRevision: task.revision,
              },
              onClose,
            );
          }}
        >
          <label className={cx("", true)}>
            Change completed at
            <input
              type="datetime-local"
              required
              value={completedAt}
              disabled={locked}
              onChange={(event) => setCompletedAt(event.target.value)}
              className={cx("", true)}
            />
          </label>
          <small>Time uses {zone}; the scheduled date stays unchanged.</small>
          <button disabled={locked} className={cx("", true)}>
            Save completion time
          </button>
          {completionError && <p role="alert">{completionError}</p>}
        </form>
      )}
      {task.seriesId && (
        <section className={cx("series-summary")}>
          <h3>Repeating task</h3>
          {series.isPending ? (
            <p>Loading repeat details…</p>
          ) : series.error ? (
            <p className={cx("error")}>Unable to load repeat details.</p>
          ) : (
            series.data && (
              <>
                <p>
                  {recurrenceSummary(
                    series.data.cadence,
                    series.data.intervalDays,
                    series.data.endDate || "",
                  )}
                </p>
                <dl>
                  <dt>Starts</dt>
                  <dd>{dateLabel(series.data.task.scheduledDate)}</dd>
                  <dt>Ends</dt>
                  <dd>
                    {series.data.endDate
                      ? dateLabel(series.data.endDate)
                      : "No end date"}
                  </dd>
                  <dt>Timezone</dt>
                  <dd>{zone}</dd>
                </dl>
                <small>
                  Each occurrence has its own focus goal and sessions. When
                  editing, choose this occurrence or current and future
                  occurrences.
                </small>
                {(series.data.stoppedAfter || stopped) && (
                  <p>
                    Recurrence stopped after{" "}
                    {dateLabel(series.data.stoppedAfter || stopDate)}.
                  </p>
                )}
              </>
            )
          )}
        </section>
      )}
      <section className={cx("series-summary")}>
        <h3>Focus sessions</h3>
        {focus.isPending ? (
          <p>Loading sessions…</p>
        ) : focus.error ? (
          <p role="alert">Unable to load sessions.</p>
        ) : !focus.data?.sessions.length ? (
          <p>No focus sessions yet.</p>
        ) : (
          <ul>
            {focus.data.sessions.map((session) => (
              <li key={session.id}>
                <strong>
                  {session.status === "ended"
                    ? "Ended early"
                    : session.status.charAt(0).toUpperCase() +
                      session.status.slice(1)}
                </strong>{" "}
                · {Math.round((session.focusSeconds / 60) * 10) / 10} active min
                / {session.targetSeconds / 60} min target
                <br />
                <small>
                  {timestamp(session.startedAt)} –{" "}
                  {session.endedAt ? timestamp(session.endedAt) : "In progress"}{" "}
                  · {zone}
                </small>
              </li>
            ))}
          </ul>
        )}
        <small>
          Active time excludes pauses and breaks. Session targets stay as they
          were when started.
        </small>
      </section>
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
            ({zone}). Earlier repetitions stay unchanged.
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
