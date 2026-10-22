"use client";
import { Timer, Pause, Play } from "lucide-react";
import type { FocusController } from "./useFocus";
import { kindLabel, timerLabel } from "./clock";
export function TimerBar({
  focus,
  onOpen,
}: {
  focus: FocusController;
  onOpen: () => void;
}) {
  const a = focus.active;
  if (!a) return null;
  return (
    <section className="timer-bar" aria-label="Active timer">
      <Timer size={18} />
      <button className="text-button timer-title" onClick={onOpen}>
        {a.taskTitle || kindLabel[a.kind]}
      </button>
      <span className="timer-digits" role="timer" aria-label="Time remaining">
        {timerLabel(focus.remaining)}
      </span>
      <span className="timer-state">
        {a.status === "paused"
          ? "Paused"
          : !focus.connected
            ? "Offline · estimated"
            : focus.remaining === 0
              ? "Confirming completion…"
              : kindLabel[a.kind]}
      </span>
      <button
        disabled={focus.blocked || focus.remaining === 0}
        onClick={() => focus.change(a.status === "paused" ? "resume" : "pause")}
      >
        {a.status === "paused" ? <Play size={14} /> : <Pause size={14} />}{" "}
        {a.status === "paused" ? "Resume" : "Pause"}
      </button>
      <button disabled={focus.blocked} onClick={() => focus.change("end")}>
        End session
      </button>
    </section>
  );
}
