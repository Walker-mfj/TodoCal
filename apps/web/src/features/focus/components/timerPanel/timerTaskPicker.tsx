import { Skeleton } from "../../../../shared/components/skeleton/skeleton";
import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./timerTaskPicker.module.css";
import type { Task } from "../../../../shared/api/domainTypes";
import type { useFocusTasks } from "../../hooks/useFocusTasks";
const cx = bindStyles(styles);
export function TimerTaskPicker({
  task,
  choices,
  selectedTask,
  blocked,
  focusDate,
  onChoose,
}: {
  task: Task | null;
  choices: ReturnType<typeof useFocusTasks>;
  selectedTask?: Task;
  blocked: boolean;
  focusDate: string;
  onChoose: (id: string, task?: Task) => void;
}) {
  return (
    <label className={cx("focus-task-picker", true)}>
      Task
      <select
        aria-label="Task"
        value={selectedTask?.id || ""}
        disabled={blocked || choices.isPending}
        onChange={(event) => {
          const next = choices.data?.find((t) => t.id === event.target.value);
          onChoose(event.target.value, next);
        }}
        className={cx("", true)}
      >
        <option value="">Free focus · no task</option>
        {(task && !choices.data?.some((t) => t.id === task.id)
          ? [task, ...(choices.data || [])]
          : choices.data || []
        ).map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
            {t.estimatedPomodoros ? ` · ${t.estimatedPomodoros} Pomodoros` : ""}
          </option>
        ))}
      </select>
      <small>
        Today’s tasks · {focusDate}. Open another day’s task from Calendar to
        focus on it.
      </small>
      {choices.isPending && (
        <small>
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
            <Skeleton width="70%" height={20} />
            <Skeleton width="95%" height={14} />
          </span>
        </small>
      )}
      {choices.error && (
        <button
          type="button"
          onClick={() => void choices.refetch()}
          className={cx("", true)}
        >
          Retry loading tasks
        </button>
      )}
      {choices.data?.length === 0 && (
        <small>Focus is optional. Choose a task or start free focus.</small>
      )}
    </label>
  );
}
