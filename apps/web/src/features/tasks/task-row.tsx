"use client";
import { Check, Repeat2 } from "lucide-react";
import type { Task, Group } from "../../lib/model";
export function TaskRow({
  task,
  groups = [],
  historical = false,
  onOpen,
  onComplete,
  disabled = false,
}: {
  task: Task;
  groups?: Group[];
  historical?: boolean;
  onOpen: () => void;
  onComplete?: (task: Task) => void;
  disabled?: boolean;
}) {
  const group = groups.find((g) => g.id === task.groupId);
  return (
    <div
      className={`task-row ${task.status === "complete" ? "completed" : ""}`}
    >
      {onComplete && !historical ? (
        <button
          className="complete-button"
          aria-label={`${task.status === "complete" ? "Reopen" : "Complete"} ${task.title}`}
          disabled={disabled}
          onClick={() => onComplete(task)}
        >
          {task.status === "complete" && <Check size={14} />}
        </button>
      ) : (
        <span className="task-status">
          {task.status === "complete" ? "✓" : "○"}
        </span>
      )}
      <button className="task-open" onClick={onOpen}>
        <strong>{task.title}</strong>
        <span>
          {task.scheduledDate || "Unscheduled"}
          {task.startTime ? ` · ${task.startTime}–${task.endTime}` : ""}
          {group ? ` · ${group.name}` : ""}
        </span>
      </button>
      {task.seriesId && <Repeat2 size={14} aria-label="Repeating" />}
      <span className={`priority ${task.priority}`}>{task.priority}</span>
    </div>
  );
}
