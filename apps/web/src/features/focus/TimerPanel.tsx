"use client";
import { X } from "lucide-react";
import type { Task, Settings } from "../../lib/model";
import { errorMessage } from "../../lib/api";
import { kindLabel } from "./clock";
import type { FocusController, FocusKind } from "./useFocus";
export function TimerPanel({
  focus,
  task,
  settings,
  onClose,
  onFree,
}: {
  focus: FocusController;
  task: Task | null;
  settings: Settings;
  onClose: () => void;
  onFree: () => void;
}) {
  return (
    <section className="focus-panel" aria-label="Focus timer">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">A LITTLE ROOM TO FOCUS</p>
          <h2>{task ? task.title : "Your time, your pace."}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close focus timer"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        Pomodoro is optional. Your tasks stay independent of the timer.
      </p>
      {task && !focus.active && (
        <button className="text-button" onClick={onFree}>
          Use free focus instead
        </button>
      )}
      {!focus.active && (
        <div className="focus-options">
          {(["focus", "short_break", "long_break"] as FocusKind[]).map(
            (kind) => (
              <button
                key={kind}
                className={
                  focus.state?.nextKind === kind
                    ? "focus-option recommended"
                    : "focus-option"
                }
                disabled={focus.blocked}
                onClick={() => focus.start(kind, task?.id)}
              >
                <span>{kindLabel[kind]}</span>
                <strong>
                  {kind === "focus"
                    ? settings.focusMinutes
                    : kind === "short_break"
                      ? settings.shortBreakMinutes
                      : settings.longBreakMinutes}
                  <small> min</small>
                </strong>
                <small>
                  {focus.state?.nextKind === kind
                    ? "Suggested next"
                    : "Start when ready"}
                </small>
              </button>
            ),
          )}
        </div>
      )}
      {focus.active && (
        <p className="notice">
          One timer is active across your account. Use the timer bar to pause,
          resume, or end it.
        </p>
      )}
      {!focus.active && focus.state?.last && (
        <p role="status" className="focus-result">
          {focus.state.last.status === "completed"
            ? "Session complete."
            : "Session ended."}{" "}
          {focus.state.last.kind === "focus"
            ? `${Math.floor(focus.state.last.focusSeconds / 60)} min ${focus.state.last.focusSeconds % 60} sec saved · ${focus.state.last.pomodoros} Pomodoro.`
            : "Break saved. Break time does not count as focus."}{" "}
          The next session starts only when you choose.
        </p>
      )}
      <div className="focus-permission">
        {focus.permission === "default" ? (
          <button
            className="text-button"
            onClick={() => void focus.enableNotifications()}
          >
            Enable completion notifications
          </button>
        ) : (
          <small>
            {focus.permission === "granted"
              ? "Completion notifications enabled."
              : focus.permission === "denied"
                ? "Notifications are blocked. The timer still works normally."
                : "Browser notifications are unavailable. The timer still works normally."}
          </small>
        )}
        <small>
          Sound {settings.sound ? "on" : "off"} · change in Settings
        </small>
      </div>
      {focus.query.error && (
        <p className="error" role="alert">
          {errorMessage(focus.query.error)}{" "}
          <button onClick={() => void focus.query.refetch()}>
            Refresh timer
          </button>
        </p>
      )}
    </section>
  );
}
