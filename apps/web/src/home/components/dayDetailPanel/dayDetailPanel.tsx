"use client";
import { bindStyles } from "../../../shared/utils/classNames";
import styles from "./dayDetailPanel.module.css";
const cx = bindStyles(styles);
import { SidebarPanel } from "../../../shared/components/sidebarPanel/sidebarPanel";
import { Ring } from "../../../shared/components/progressRing/progressRing";
import {
  DayFocusDetails,
  type AnalyticsDay,
} from "../../../features/analytics";
import { TaskRow } from "../../../features/tasks";
import { completionRatio } from "../../../shared/utils/progress";
import { dateLabel } from "../../../shared/utils/dateUtils";
import { errorMessage } from "../../../shared/api/apiClient";
import type { Task } from "../../../shared/api/domainTypes";
export function DayDetailPanel({
  day,
  selectedDate,
  date,
  onClose,
  onTask,
}: {
  day: { data?: AnalyticsDay; isPending: boolean; error: unknown };
  selectedDate: string;
  date: string;
  onClose: () => void;
  onTask: (task: Task, historical: boolean) => void;
}) {
  return (
    <SidebarPanel
      className={cx("day-detail")}
      label="Day details"
      eyebrow="DAILY PROGRESS"
      title={dateLabel(selectedDate, "EEEE, MMM d")}
      closeLabel="Close day details"
      onClose={onClose}
    >
      {day.isPending ? (
        <p>Loading day…</p>
      ) : day.error ? (
        <p className={cx("error")}>{errorMessage(day.error)}</p>
      ) : (
        day.data && (
          <>
            <Ring
              value={day.data.percentage}
              ratio={completionRatio(day.data)}
            />
            <p>
              {day.data.completed} of {day.data.planned} tasks complete
            </p>
            <small>
              {day.data.finalized
                ? `Historical plan · ${day.data.timezone} · editable`
                : selectedDate > date
                  ? "Planned for the future"
                  : "Live progress · all tasks"}
            </small>
            <p className={cx("day-encouragement")}>
              {day.data.percentage === 100
                ? "This plan is complete."
                : day.data.completed > 0
                  ? "Each completed task is part of your progress."
                  : day.data.finalized
                    ? "A record of your plan for this day."
                    : selectedDate > date
                      ? "Your plan for this upcoming day."
                      : "One small step is a good place to start."}
            </p>
            <DayFocusDetails day={day.data} />
            <div className={cx("day-tasks")}>
              {day.data.entries.map((e) => (
                <TaskRow
                  key={e.task.id}
                  task={e.task}
                  historical
                  groups={
                    e.task.groupId && e.groupName
                      ? [
                          {
                            id: e.task.groupId,
                            name: e.groupName,
                            color: e.groupColor || "#999",
                            revision: 1,
                          },
                        ]
                      : []
                  }
                  onOpen={() => onTask(e.task, day.data!.finalized)}
                />
              ))}
            </div>
            {!day.data.planned && (
              <p className={cx("muted")}>No tasks planned for this day.</p>
            )}
          </>
        )
      )}
    </SidebarPanel>
  );
}
