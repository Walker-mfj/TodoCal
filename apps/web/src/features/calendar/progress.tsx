"use client";
import { DateTime } from "luxon";
import type { CSSProperties } from "react";
import {
  dateLabel,
  progressLevel,
  completionRatio,
  type Day,
} from "../../lib/model";
export function Ring({
  value,
  small = false,
  ratio,
}: {
  value: number | null;
  small?: boolean;
  ratio?: number | null;
}) {
  return (
    <span
      className={`progress-ring ${progressLevel(ratio === undefined ? value : ratio)} ${small ? "small" : ""}`}
      style={{ "--progress": `${(value || 0) * 3.6}deg` } as CSSProperties}
    >
      <span>{value === null ? "—" : `${value}%`}</span>
      {value === 100 && (
        <i className="ring-check" aria-label="Plan complete">
          ✓
        </i>
      )}
    </span>
  );
}
export function DailyProgress({
  day,
  onOpen,
}: {
  day?: Day;
  onOpen: (date: string) => void;
}) {
  if (!day)
    return (
      <section className="progress-hero" aria-busy="true">
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
    <section className={`progress-hero ${progressLevel(completionRatio(day))}`}>
      <Ring value={day.percentage} ratio={completionRatio(day)} />
      <div>
        <p className="eyebrow">TODAY · {dateLabel(day.date, "EEE, MMM d")}</p>
        <h2>{title}</h2>
        <p>
          {day.planned
            ? `${day.completed} of ${day.planned} tasks complete. ${day.percentage === 100 ? "Enjoy a well-earned pause." : "Every small step counts."}`
            : "No tasks planned yet. Start with one thing that matters."}
        </p>
      </div>
      <button onClick={() => onOpen(day.date)}>
        View day <span aria-hidden="true">↗</span>
      </button>
    </section>
  );
}
export function ProgressLegend() {
  return (
    <div className="progress-legend" aria-label="Completion levels">
      {[
        ["zero", "0%"],
        ["starting", ">0–<50%"],
        ["building", "50–<80%"],
        ["strong", "80–<100%"],
        ["complete", "100%"],
        ["empty", "No plan / future"],
      ].map(([level, label]) => (
        <span key={level}>
          <i className={level} />
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
    <div className="day-strip">
      {month &&
        ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="weekday-heading">
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
          className={`day-progress ${progressLevel(completionRatio(d))}`}
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
