"use client";
import { Skeleton } from "../../../shared/components/skeleton/skeleton";
import { bindStyles } from "../../../shared/utils/classNames";
import styles from "./taskListPanel.module.css";
const cx = bindStyles(styles);
import { ListTodo } from "lucide-react";
import { TaskRow } from "../../../features/tasks";
import { errorMessage } from "../../../shared/api/apiClient";
import type { Task, Group } from "../../../shared/api/domainTypes";
export function TaskListPanel({
  tasks,
  zone,
  allGroups,
  disabled,
  complete,
  onOpen,
  onCreate,
  view,
  setView,
  cursor,
  setCursor,
}: {
  tasks: {
    data?: { items: Task[]; nextCursor: string | null };
    isPending: boolean;
    error: unknown;
  };
  zone: string;
  allGroups: Group[];
  disabled: boolean;
  complete: (task: Task) => void;
  onOpen: (task: Task) => void;
  onCreate: () => void;
  view: string;
  setView: (value: string) => void;
  cursor: string;
  setCursor: (value: string) => void;
}) {
  return (
    <section className={cx("task-list-card")}>
      <div className={cx("list-heading")}>
        <h2>Your tasks</h2>
        <select
          aria-label="Task view"
          value={view}
          onChange={(e) => setView(e.target.value)}
          className={cx("", true)}
        >
          {[
            ["all", "All tasks"],
            ["today", "Today"],
            ["upcoming", "Upcoming"],
            ["overdue", "Overdue"],
            ["unscheduled", "Unscheduled"],
            ["previously-unfinished", "Previously unfinished"],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {tasks.isPending ? (
        <div>
          <span role="status" aria-label="Loading tasks…" aria-live="polite">
            <span
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                overflow: "hidden",
                clipPath: "inset(50%)",
              }}
              className="sr-only"
            >
              Loading tasks…
            </span>
            {[0, 1, 2].map((row) => (
              <span
                key={row}
                style={{ display: "flex", gap: 12, marginBlock: 12 }}
              >
                <Skeleton width={32} height={32} variant="circle" />
                <Skeleton width="70%" height={28} />
              </span>
            ))}
          </span>
        </div>
      ) : tasks.error ? (
        <p className={cx("error")}>{errorMessage(tasks.error)}</p>
      ) : tasks.data?.items.length ? (
        tasks.data.items.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            zone={zone}
            groups={allGroups}
            disabled={disabled}
            onComplete={complete}
            onOpen={() => onOpen(t)}
          />
        ))
      ) : (
        <div className={cx("empty-state")}>
          <ListTodo size={30} />
          <h3>A little space to begin.</h3>
          <p>No tasks match this view.</p>
          <button onClick={() => onCreate()} className={cx("", true)}>
            Add your first task
          </button>
        </div>
      )}
      <div className={cx("pagination")}>
        {cursor && (
          <button onClick={() => setCursor("")} className={cx("", true)}>
            First page
          </button>
        )}
        {tasks.data?.nextCursor && (
          <button
            onClick={() => setCursor(tasks.data!.nextCursor!)}
            className={cx("", true)}
          >
            Next 100 tasks
          </button>
        )}
      </div>
    </section>
  );
}
