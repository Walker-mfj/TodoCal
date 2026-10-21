"use client";
import { DateTime } from "luxon";
import type { CSSProperties } from "react";
import { dateLabel, progressLevel, type Day } from "../../lib/model";
export function Ring({
  value,
  small = false,
}: {
  value: number | null;
  small?: boolean;
}) {
  return (
    <span
      className={`progress-ring ${progressLevel(value)} ${small ? "small" : ""}`}
      style={{ "--progress": `${(value || 0) * 3.6}deg` } as CSSProperties}
    >
      <span>{value === null ? "—" : value === 100 ? "✓" : `${value}%`}</span>
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
    <section className={`progress-hero ${progressLevel(day.percentage)}`}>
      <Ring value={day.percentage} />
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
        ["starting", "1–49%"],
        ["building", "50–79%"],
        ["strong", "80–99%"],
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
}: {
  days: Day[];
  month?: boolean;
  onOpen: (date: string) => void;
}) {
  return (
    <div className="day-strip">
      {month &&
        days.length > 0 &&
        Array.from(
          { length: DateTime.fromISO(days[0].date).weekday - 1 },
          (_, i) => <span key={`blank-${i}`} aria-hidden="true" />,
        )}
      {days.map((d) => (
        <button
          key={d.date}
          className={`day-progress ${progressLevel(d.percentage)}`}
          onClick={() => onOpen(d.date)}
          aria-label={`${dateLabel(d.date)}: ${d.percentage === null ? "No completion percentage" : `${d.percentage}% complete`}`}
        >
          <span>{dateLabel(d.date, "EEE d")}</span>
          <Ring value={d.percentage} small />
          <small>{d.planned ? `${d.completed}/${d.planned}` : "No plan"}</small>
        </button>
      ))}
    </div>
  );
}
