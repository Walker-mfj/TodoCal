import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./taskEditorFields.module.css";
import { priorityLabels } from "../../../../shared/constants/priorityLabels";
import { recurrenceSummary } from "../../utils/recurrenceSummary";
import type { Draft } from "../../types/taskTypes";
import type {
  Group,
  Task,
  RecurrenceRule,
} from "../../../../shared/api/domainTypes";
const cx = bindStyles(styles);
type Fields = {
  draft: Draft;
  change: (key: keyof Draft, value: string | number) => void;
};
export function TaskContentFields({
  draft,
  change,
  groups,
}: Fields & { groups: Group[] }) {
  return (
    <>
      {" "}
      <label className={cx("", true)}>
        Task title
        <input
          autoFocus
          required
          maxLength={300}
          name="title"
          value={draft.title}
          onChange={(e) => change("title", e.target.value)}
          placeholder="What would you like to do?"
          className={cx("", true)}
        />
      </label>
      <label className={cx("", true)}>
        Description
        <textarea
          rows={3}
          maxLength={10000}
          name="description"
          value={draft.description || ""}
          onChange={(e) => change("description", e.target.value)}
          placeholder="A few helpful details…"
          className={cx("", true)}
        />
      </label>
      <div className={cx("form-row")}>
        <label className={cx("", true)}>
          Group
          <span className={cx("select-wrap")}>
            <select
              name="groupId"
              value={draft.groupId || ""}
              onChange={(e) => change("groupId", e.target.value)}
              className={cx("", true)}
            >
              <option value="">No group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className={cx("", true)}>
          Priority
          <span className={cx("select-wrap")}>
            <select
              name="priority"
              value={draft.priority || "medium"}
              onChange={(e) => change("priority", e.target.value)}
              className={cx("", true)}
            >
              {(["low", "medium", "high"] as const).map((p) => (
                <option key={p} value={p}>
                  {priorityLabels[p]}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>
    </>
  );
}
export function TaskScheduleFields({
  draft,
  change,
  zone,
}: Fields & { zone: string }) {
  return (
    <>
      {" "}
      <label className={cx("", true)}>
        Scheduled date
        <input
          type="date"
          name="scheduledDate"
          value={draft.scheduledDate || ""}
          onChange={(e) => change("scheduledDate", e.target.value)}
          className={cx("", true)}
        />
      </label>
      <div className={cx("form-row")}>
        <label className={cx("", true)}>
          Start time
          <input
            type="time"
            name="startTime"
            value={draft.startTime || ""}
            onChange={(e) => change("startTime", e.target.value)}
            className={cx("", true)}
          />
        </label>
        <label className={cx("", true)}>
          End time
          <input
            type="time"
            name="endTime"
            value={draft.endTime || ""}
            onChange={(e) => change("endTime", e.target.value)}
            className={cx("", true)}
          />
        </label>
      </div>
      {!!(draft.startTime || draft.endTime) && (
        <label className={cx("", true)}>
          Scheduled end date
          <input
            type="date"
            name="scheduledEndDate"
            value={draft.scheduledEndDate || draft.scheduledDate || ""}
            onChange={(e) => change("scheduledEndDate", e.target.value)}
            className={cx("", true)}
          />
        </label>
      )}
      <small>Leave times empty for an untimed task. Times use {zone}.</small>
      <label className={cx("", true)}>
        Deadline (optional)
        <input
          type="datetime-local"
          name="deadline"
          value={draft.deadline || ""}
          onChange={(e) => change("deadline", e.target.value)}
          className={cx("", true)}
        />
      </label>
    </>
  );
}
export function TaskRecurrenceFields({
  draft,
  change,
  task,
  seriesRule,
}: Fields & { task?: Task; seriesRule: RecurrenceRule | null }) {
  return (
    <>
      {" "}
      {(!task || task.seriesId) && (
        <>
          <label className={cx("", true)}>
            Repeat
            <span className={cx("select-wrap")}>
              <select
                name="cadence"
                value={draft.cadence || seriesRule?.cadence || "none"}
                onChange={(e) => change("cadence", e.target.value)}
                className={cx("", true)}
              >
                {!task && <option value="none">Does not repeat</option>}
                <option value="daily">Daily</option>
                <option value="interval">Every N days</option>
                <option value="weekly">Weekly</option>
              </select>
            </span>
          </label>
          {(draft.cadence || seriesRule?.cadence) &&
            draft.cadence !== "none" && (
              <>
                {(draft.cadence || seriesRule?.cadence) === "interval" && (
                  <label className={cx("", true)}>
                    Every (days)
                    <input
                      type="number"
                      min={2}
                      max={365}
                      name="intervalDays"
                      value={
                        draft.intervalDays || seriesRule?.intervalDays || 2
                      }
                      onChange={(e) => {
                        change("intervalDays", Number(e.target.value));
                        if (task && !draft.cadence && seriesRule)
                          change("cadence", seriesRule.cadence);
                      }}
                      className={cx("", true)}
                    />
                  </label>
                )}
                <label className={cx("", true)}>
                  Repeat until (inclusive)
                  <input
                    type="date"
                    min={task ? undefined : draft.scheduledDate}
                    name="endDate"
                    value={draft.endDate ?? seriesRule?.endDate ?? ""}
                    onChange={(e) => {
                      change("endDate", e.target.value);
                      if (task && !draft.cadence && seriesRule)
                        change("cadence", seriesRule.cadence);
                    }}
                    className={cx("", true)}
                  />
                </label>
                {seriesRule?.timezone && (
                  <small>Repeats in {seriesRule.timezone}.</small>
                )}
                <p className={cx("recurrence-summary")}>
                  {recurrenceSummary(
                    draft.cadence || seriesRule?.cadence || "none",
                    draft.intervalDays || seriesRule?.intervalDays || 2,
                    draft.endDate ?? seriesRule?.endDate ?? undefined,
                  )}
                </p>
              </>
            )}
        </>
      )}
    </>
  );
}
export function TaskFocusFields({
  draft,
  change,
  planFocus,
  onPlanFocusChange,
  defaultFocusMinutes,
}: Fields & {
  planFocus: boolean;
  onPlanFocusChange: (checked: boolean) => void;
  defaultFocusMinutes: number;
}) {
  return (
    <>
      {" "}
      <label className={cx("checkbox-label", true)}>
        <input
          type="checkbox"
          checked={planFocus}
          onChange={(e) => {
            onPlanFocusChange(e.target.checked);
          }}
          className={cx("", true)}
        />
        Plan focus
      </label>
      {planFocus && (
        <>
          <div className={cx("form-row")}>
            <label className={cx("", true)}>
              Planned Pomodoros
              <input
                type="number"
                required
                min={1}
                max={2147483647}
                name="estimatedPomodoros"
                value={draft.estimatedPomodoros}
                onChange={(e) => change("estimatedPomodoros", e.target.value)}
                className={cx("", true)}
              />
            </label>
            <label className={cx("", true)}>
              Session length (minutes)
              <input
                type="number"
                required
                min={1}
                max={180}
                name="focusMinutes"
                value={draft.focusMinutes ?? String(defaultFocusMinutes)}
                onChange={(e) => change("focusMinutes", e.target.value)}
                className={cx("", true)}
              />
            </label>
          </div>
          <p>
            Planned Focus Time:{" "}
            {Number(draft.estimatedPomodoros) *
              Number(draft.focusMinutes ?? defaultFocusMinutes)}{" "}
            min
          </p>
          <small>
            Focus time is separate from your calendar schedule. Completing focus
            does not complete the task.
          </small>
        </>
      )}
    </>
  );
}
