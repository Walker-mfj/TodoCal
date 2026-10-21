"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { useOwnedQuery, type Execute } from "../../app/providers";
import { useCommand } from "../../lib/use-command";
import {
  dateLabel,
  recurrenceSummary,
  type Task,
  type Group,
  type Day,
} from "../../lib/model";
import type { components } from "../../lib/api-types";
export function TaskDetail({
  task,
  historical,
  groups,
  execute,
  disabled,
  onClose,
  onEdit,
  onCurrent,
  onComplete,
  onDeleted,
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
  onDeleted: () => void;
}) {
  const series = useOwnedQuery<components["schemas"]["RecurrenceSeries"]>(
    "series",
    `/series/${task.seriesId}`,
    !!task.seriesId && !historical,
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
  return (
    <aside className="detail-panel">
      <div className="panel-heading">
        <p className="eyebrow">
          {historical ? "HISTORICAL SNAPSHOT" : "TASK DETAILS"}
        </p>
        <button
          className="icon-button"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <span className={`priority ${task.priority}`}>
        {task.priority} priority
      </span>
      <h2 className="task-title">{task.title}</h2>
      <p className="description">
        {task.description || "No description added."}
      </p>
      <dl>
        <dt>Status</dt>
        <dd>{task.status === "complete" ? "Complete" : "To do"}</dd>
        <dt>Group</dt>
        <dd>{groupName}</dd>
        <dt>Schedule</dt>
        <dd>
          {task.scheduledDate ? dateLabel(task.scheduledDate) : "Unscheduled"}
          <br />
          {task.startTime ? `${task.startTime}–${task.endTime}` : "Untimed"}
        </dd>
        <dt>Pomodoros</dt>
        <dd>{task.estimatedPomodoros || "Not needed"}</dd>
      </dl>
      {historical ? (
        <>
          <p className="notice">
            This day is finalized. Changes to the current task will not rewrite
            this record.
          </p>
          <button className="wide" onClick={onCurrent}>
            Open current task
          </button>
        </>
      ) : (
        <>
          <div className="button-stack">
            <button
              className="primary"
              disabled={disabled}
              onClick={() => onComplete(task)}
            >
              {task.status === "complete" ? "Mark incomplete" : "Mark complete"}
            </button>
            <button onClick={onEdit}>Edit task</button>
          </div>
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
                    <small>Edits affect this occurrence only.</small>
                    {series.data.stoppedAfter || stopped ? (
                      <p>Recurrence stopped.</p>
                    ) : (
                      <button
                        disabled={disabled || command.busy || command.uncertain}
                        onClick={() => {
                          if (
                            command.uncertain ||
                            confirm(
                              "Stop repeating after today? Future incomplete occurrences will be removed. Today and history are kept.",
                            )
                          )
                            void command.run(
                              `/series/${task.seriesId}/stop`,
                              "POST",
                              { expectedRevision: series.data!.revision },
                              () => setStopped(true),
                            );
                        }}
                      >
                        {command.uncertain
                          ? "Retry stop"
                          : "Stop repeating after today"}
                      </button>
                    )}
                  </>
                )
              )}
            </section>
          )}
          {command.error && (
            <p className="error" role="alert">
              {command.error}
            </p>
          )}
          <button
            className="danger wide"
            disabled={disabled || command.busy || command.uncertain}
            onClick={() => {
              if (
                confirm(
                  `Delete “${task.title}”? Historical records will be kept.`,
                )
              )
                void command.run(
                  `/tasks/${task.id}`,
                  "DELETE",
                  { expectedRevision: task.revision },
                  onDeleted,
                );
            }}
          >
            Delete task
          </button>
          {command.uncertain && (
            <button onClick={() => void command.run("", "", null, onDeleted)}>
              Retry request
            </button>
          )}
        </>
      )}
    </aside>
  );
}
