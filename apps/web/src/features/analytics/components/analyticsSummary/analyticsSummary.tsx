"use client";
import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./analyticsSummary.module.css";
const cx = bindStyles(styles);

import { DateTime } from "luxon";
import type { components } from "../../../../shared/api/apiTypes.generated";
import {
  completionRatio,
  progressLevel,
} from "../../../../shared/utils/progress";
import { dateLabel } from "../../../../shared/utils/dateUtils";
import { Ring } from "../../../../shared/components/progressRing/progressRing";
export type PeriodReport = components["schemas"]["PeriodReport"];
export type AnalyticsDay = components["schemas"]["AnalyticsDay"];
export function duration(seconds: number) {
  const mins = Math.floor(Math.abs(seconds) / 60);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
export function AnalyticsSummary({
  report,
  onDay,
}: {
  report: PeriodReport;
  onDay: (date: string) => void;
}) {
  const m = report.metrics,
    c = report.comparison;
  return (
    <>
      <div className={cx("analytics-metrics")}>
        <article className={cx("metric plan-metric")}>
          <span>Plan completion</span>
          <Ring value={m.percentage} ratio={completionRatio(m)} />
          <small>
            By scheduled date · {m.completed}/{m.planned} planned occurrences
          </small>
        </article>
        <article className={cx("metric")}>
          <span>Completed tasks</span>
          <strong>{m.completedTasks}</strong>
          <small>By completion date · includes unscheduled</small>
        </article>
        <article className={cx("metric")}>
          <span>Focus time</span>
          <strong>{duration(m.focusSeconds)}</strong>
          <small>
            {m.focusSeconds === 0
              ? "No focus sessions yet"
              : "Actual running time"}
          </small>
        </article>
        <article className={cx("metric")}>
          <span>Pomodoros</span>
          <strong>{m.pomodoros}</strong>
          <small>Full focus sessions</small>
        </article>
        <article className={cx("metric")}>
          <span>Completed plans</span>
          <strong>
            {m.completeDays}/{m.plannedDays}
          </strong>
          <small>Days with planned tasks</small>
        </article>
      </div>
      <div className={cx("period-comparison")}>
        <strong>
          Compared with {dateLabel(c.from)} –{" "}
          {DateTime.fromISO(c.through)
            .setZone(report.timezone)
            .toFormat("MMM d, yyyy HH:mm")}{" "}
          ({report.timezone})
        </strong>
        <p>
          {c.percentagePointChange === null
            ? "Not enough data to compare completion."
            : `${c.percentagePointChange >= 0 ? "+" : ""}${c.percentagePointChange.toFixed(1)} percentage points in plan completion.`}{" "}
          {c.focusSecondsChange === null
            ? "Not enough data to compare focus time."
            : `${c.focusSecondsChange >= 0 ? "+" : "−"}${duration(c.focusSecondsChange)} focus time.`}
        </p>
        <small>
          Current data through{" "}
          {DateTime.fromISO(report.through)
            .setZone(report.timezone)
            .toFormat("MMM d, yyyy HH:mm")}
          . Future dates are excluded.
        </small>
      </div>
      <DailyChart days={report.days} type="completion" onDay={onDay} />
      <DailyChart days={report.days} type="focus" onDay={onDay} />
    </>
  );
}
function DailyChart({
  days,
  type,
  onDay,
}: {
  days: AnalyticsDay[];
  type: "completion" | "focus";
  onDay: (date: string) => void;
}) {
  const ceiling =
    type === "completion"
      ? 100
      : Math.max(1, ...days.map((d) => d.focusSeconds / 60));
  return (
    <section
      className={cx("daily-chart")}
      aria-label={
        type === "completion" ? "Daily completion chart" : "Daily focus chart"
      }
    >
      <h3>
        {type === "completion"
          ? "Daily plan completion"
          : "Daily focus minutes"}
      </h3>
      {type === "focus" && days.every((d) => d.focusSeconds === 0) ? (
        <p className={cx("muted")}>
          No focus sessions yet. Task progress counts in full without a timer.
        </p>
      ) : (
        <div className={cx("chart-layout")}>
          <div className={cx("chart-axis")}>
            <span>
              {Math.ceil(ceiling)}
              {type === "completion" ? "%" : ""}
            </span>
            <span>
              {Math.round(ceiling / 2)}
              {type === "completion" ? "%" : ""}
            </span>
            <span>0</span>
          </div>
          <div className={cx("chart-columns")}>
            {days.map((d) => {
              const value =
                type === "completion"
                  ? completionRatio(d)
                  : d.focusSeconds / 60;
              return (
                <button
                  key={d.date}
                  className={cx(
                    `chart-column ${type === "completion" ? progressLevel(completionRatio(d)) : "focus"}`,
                    true,
                  )}
                  onClick={() => onDay(d.date)}
                  aria-label={`${dateLabel(d.date)}: ${value === null ? "No completion percentage" : type === "completion" ? `${d.percentage}% complete` : `${Math.floor(d.focusSeconds / 60)} focus minutes`}`}
                >
                  <span className={cx("chart-track")}>
                    <i
                      style={{
                        height: `${value === null ? 0 : (value / ceiling) * 100}%`,
                      }}
                    />
                    {value === null && <em>—</em>}
                  </span>
                  <small>{dateLabel(d.date, "d")}</small>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
export function DayFocusDetails({ day }: { day: AnalyticsDay }) {
  return (
    <section className={cx("day-focus")}>
      <h3>Focus · {duration(day.focusSeconds)}</h3>
      <small>Focus dates use {day.focusTimezone}.</small>
      <p>
        {day.completedTasks} completed tasks · {day.pomodoros} Pomodoros
      </p>
      {day.focusSessions.length === 0 ? (
        <p className={cx("muted")}>No focus sessions yet.</p>
      ) : (
        <ul>
          {day.focusSessions.map((s) => (
            <li key={s.id}>
              <strong>{s.taskTitle || "Free focus"}</strong>
              <span>
                {duration(s.focusSeconds)} · {s.pomodoros} Pomodoro
                {s.pomodoros === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
