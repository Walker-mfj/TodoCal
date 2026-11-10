import { Dialog } from "../../../../shared/components/dialog/dialog";
import { Repeat2 } from "lucide-react";
import { bindStyles } from "../../../../shared/utils/classNames";
import type { Task } from "../../../../shared/api/domainTypes";
import type { Draft } from "../../types/taskTypes";
const cx = bindStyles();
export function RecurrenceScopeDialog({
  task,
  draft,
  seriesRevision,
  seriesError,
  onDismiss,
  onSave,
}: {
  task?: Task;
  draft: Draft;
  seriesRevision: number | null;
  seriesError: string;
  onDismiss: () => void;
  onSave: (scope: "one" | "following") => void;
}) {
  return (
    <Dialog
      title="Edit repeating task"
      icon={Repeat2}
      onDismiss={() => onDismiss()}
      description={`Change this task and future repetitions starting ${task?.originalOccurrenceDate || task?.scheduledDate}. Earlier repetitions stay unchanged. Completed or focused tasks retain their accepted values. Recurrence rule changes require This and following.`}
      actions={
        <>
          <button
            type="button"
            disabled={!!draft.cadence}
            onClick={() => onSave("one")}
            className={cx("", true)}
          >
            This occurrence
          </button>
          <button
            type="button"
            className={cx("primary", true)}
            disabled={
              seriesRevision === null ||
              task?.status === "complete" ||
              !!task?.actualFocusSeconds
            }
            onClick={() => onSave("following")}
          >
            This and following
          </button>
        </>
      }
    >
      {seriesError && (
        <p role="alert" className={cx("error")}>
          {seriesError}
        </p>
      )}
    </Dialog>
  );
}
