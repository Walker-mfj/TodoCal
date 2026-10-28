"use client";
import { PriorityBadge } from "../../components/priority-badge";
import { Dialog } from "../../components/dialog";
import { Repeat2 } from "lucide-react";
import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import { SidebarPanel } from "../../components/sidebar-panel";
import { useOwnedQuery, type Execute } from "../../app/providers";
import { useCommand } from "../../lib/use-command";
import {
  dateLabel,
  recurrenceSummary,
  today,
  type Task,
  type Group,
  type Day,
} from "../../lib/model";
import type { components } from "../../lib/api-types";

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
  const [deleteChoice, setDeleteChoice] = useState(false);
  const [stopped, setStopped] = useState(false);
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
    if (!task.seriesId || !series.data) return;
    const seriesId = task.seriesId,
      revision = series.data.revision;
    setDeleteChoice(false);
    void command.run(
      `/series/${seriesId}/stop`,
      "POST",
      { expectedRevision: revision },
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
      <h2 className="task-title">{task.title}</h2>
      <p className="description">
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
        <p className="notice">
          Changes update this day and its Analytics after saving.
        </p>
      )}
      <div className="button-stack">
        <button
          className="primary"
          disabled={locked}
          onClick={() => onComplete(task)}
        >
          {task.status === "complete" ? "Mark incomplete" : "Mark complete"}
        </button>
        <button disabled={locked} onClick={onEdit}>
          Edit task
        </button>
        {onFocus && (
          <button disabled={locked} onClick={onFocus}>
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
          <label>
            Change completed at
            <input
              type="datetime-local"
              required
              value={completedAt}
              disabled={locked}
              onChange={(event) => setCompletedAt(event.target.value)}
            />
          </label>
          <small>Time uses {zone}; the scheduled date stays unchanged.</small>
          <button disabled={locked}>Save completion time</button>
          {completionError && <p role="alert">{completionError}</p>}
        </form>
      )}
      {task.seriesId && (
        <section className="series-summary">
          <h3>Repeating task</h3>
          {series.isPending ? (
            <p>Loading repeat details…</p>
          ) : series.error ? (
            <p className="error">Unable to load repeat details.</p>
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
      <section className="series-summary">
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
        <p className="error" role="alert">
          {command.error}
        </p>
      )}
      <button
        className="danger wide"
        disabled={locked}
        onClick={() => (task.seriesId ? setDeleteChoice(true) : remove())}
      >
        Delete task
      </button>
      {command.uncertain && (
        <button
          disabled={command.busy}
          onClick={() => void command.run("", "", null)}
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
              <button className="danger" disabled={locked} onClick={remove}>
                Delete this occurrence
              </button>
              <button
                className="danger"
                disabled={
                  locked ||
                  !series.data ||
                  !!series.data.stoppedAfter ||
                  stopped
                }
                onClick={stop}
              >
                Stop repeating
              </button>
            </>
          }
        >
          <p>
            Delete this occurrence removes only this task. Other dates stay
            unchanged.
          </p>
          <p>
            Stop repeating after {dateLabel(stopDate)} ({zone}). Today, past
            tasks and completed future tasks are kept; future incomplete
            occurrences are removed.
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
