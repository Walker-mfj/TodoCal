"use client";
import { useEffect, useRef } from "react";
import { Draggable } from "@fullcalendar/interaction";
import { Check, Repeat2, GripVertical } from "lucide-react";
import type { Task, Group } from "../../lib/model";
export function TaskRow({
  task,
  groups = [],
  historical = false,
  onOpen,
  onComplete,
  disabled = false,
  draggable = false,
}: {
  task: Task;
  groups?: Group[];
  historical?: boolean;
  onOpen: () => void;
  onComplete?: (task: Task) => void;
  disabled?: boolean;
  draggable?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!draggable || disabled || !element.current) return;
    const drag = new Draggable(element.current, {
      itemSelector: ".drag-handle",
      eventData: () => ({
        title: task.title,
        duration: "00:30:00",
        extendedProps: { task },
      }),
    });
    return () => drag.destroy();
  }, [task, draggable, disabled]);
  const group = groups.find((g) => g.id === task.groupId);
  return (
    <div
      ref={element}
      className={`task-row ${task.status === "complete" ? "completed" : ""}`}
    >
      {draggable && (
        <span
          className="drag-handle"
          title="Drag to schedule; or open task to edit its date"
          aria-hidden="true"
        >
          <GripVertical size={16} />
        </span>
      )}
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
      {task.status === "complete" && (
        <span className="completed-label">Completed</span>
      )}
      {task.seriesId && <Repeat2 size={14} aria-label="Repeating" />}
      <span className={`priority ${task.priority}`}>{task.priority}</span>
    </div>
  );
}
