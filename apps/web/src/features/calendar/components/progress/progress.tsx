"use client";
import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./progress.module.css";
const cx = bindStyles(styles);

import { DateTime } from "luxon";
import { dateLabel } from "../../../../shared/utils/dateUtils";
import {
  progressLevel,
  completionRatio,
} from "../../../../shared/utils/progress";
import { type Day } from "../../../../shared/api/domainTypes";
import { Ring } from "../../../../shared/components/progressRing/progressRing";
export function DailyProgress({
  day,
  onOpen,
}: {
  day?: Day;
  onOpen: (date: string) => void;
}) {
  if (!day)
    return (
      <section className={cx("progress-hero")} aria-busy="true">
        Loading today’s progress…
      </section>
    );
  const title =
    day.percentage === 100
      ? "You made room. You made it happen."
      : day.completed > 0
        ? "Look at you, making progress."
        : "A fresh start, at your own pace.";
  return (
    <section
      className={cx(`progress-hero ${progressLevel(completionRatio(day))}`)}
    >
      <Ring value={day.percentage} ratio={completionRatio(day)} />
      <div>
        <p className={cx("eyebrow")}>
          TODAY · {dateLabel(day.date, "EEE, MMM d")}
        </p>
        <h2>{title}</h2>
        <p>
          {day.planned
            ? `${day.completed} of ${day.planned} tasks complete. ${day.percentage === 100 ? "Enjoy a well-earned pause." : "Every small step counts."}`
            : "No tasks planned yet. Start with one thing that matters."}
        </p>
      </div>
      <button onClick={() => onOpen(day.date)} className={cx("", true)}>
        View day <span aria-hidden="true">↗</span>
      </button>
    </section>
  );
}
export function ProgressLegend() {
  return (
    <div className={cx("progress-legend")} aria-label="Completion levels">
      {[
        ["zero", "0%"],
        ["starting", ">0–<50%"],
        ["building", "50–<80%"],
        ["strong", "80–<100%"],
        ["complete", "100%"],
        ["empty", "No plan / future"],
      ].map(([level, label]) => (
        <span key={level}>
          <i className={cx(level)} />
          {label}
        </span>
      ))}
    </div>
  );
}
export function DayStrip({
  days,
  onOpen,
  month = false,
  selectedDate,
}: {
  days: Day[];
  month?: boolean;
  selectedDate?: string;
  onOpen: (date: string) => void;
}) {
  return (
    <div className={cx("day-strip")}>
      {month &&
        ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className={cx("weekday-heading")}>
            {d}
          </span>
        ))}
      {month &&
        days.length > 0 &&
        Array.from(
          { length: DateTime.fromISO(days[0].date).weekday - 1 },
          (_, i) => <span key={`blank-${i}`} aria-hidden="true" />,
        )}
      {days.map((d) => (
        <button
          key={d.date}
          className={cx(
            `day-progress ${progressLevel(completionRatio(d))}`,
            true,
          )}
          aria-pressed={selectedDate === d.date}
          onClick={() => onOpen(d.date)}
          title={dateLabel(d.date)}
        >
          <span>{dateLabel(d.date, "EEE d")}</span>
          <Ring value={d.percentage} ratio={completionRatio(d)} small />
          <small>
            {d.date > DateTime.now().setZone(d.timezone).toISODate()!
              ? "Upcoming"
              : d.percentage === 100
                ? "Plan complete"
                : d.planned
                  ? `${d.completed}/${d.planned}`
                  : "No plan"}
          </small>
        </button>
      ))}
    </div>
  );
}
