"use client";
import { LoadingIndicator } from "../../../../shared/components/loadingIndicator/loadingIndicator";

import { usePendingAction } from "../../../../shared/hooks/usePendingAction";

import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./timerPanel.module.css";
const cx = bindStyles(styles);

import { useEffect, useRef, useState } from "react";
import { today } from "../../../../shared/utils/dateUtils";
import type { Task, Settings } from "../../../../shared/api/domainTypes";
import { kindLabel } from "../../utils/clock";
import type { FocusController, FocusKind } from "../../hooks/useFocus";
import { useRemaining } from "../../hooks/useRemaining";
import { useFocusTasks } from "../../hooks/useFocusTasks";
import { TimerTaskPicker } from "./timerTaskPicker";
import { TimerClock } from "./timerClock";
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
  const actions = usePendingAction();
  const focusDate = today(settings.timezone);
  const choices = useFocusTasks(focusDate);
  const [selectedId, setSelectedId] = useState(task?.id || "");
  const selectedTask =
    choices.data?.find((t) => t.id === selectedId) ||
    (task?.id === selectedId ? task : undefined);
  const [kind, setKind] = useState<FocusKind>(focus.state?.nextKind || "focus");
  const [durations, setDurations] = useState({
    focus: String(task?.focusMinutes ?? settings.focusMinutes),
    short_break: String(settings.shortBreakMinutes),
    long_break: String(settings.longBreakMinutes),
  });
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    close.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (
        event.key === "Tab" &&
        !close.current?.closest("section")?.contains(document.activeElement)
      ) {
        event.preventDefault();
        close.current?.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const active = focus.active;
  const remaining = useRemaining(active, focus.receivedAt);
  const currentKind = active?.kind || kind;
  const minutes = Number(durations[currentKind]);
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 180;
  const seconds = active ? remaining : valid ? minutes * 60 : 0;
  const ratio = active ? seconds / active.targetSeconds : 1;
  return (
    <section
      className={cx("focus-panel focus-scene")}
      role="dialog"
      aria-modal="true"
      aria-label="Focus timer"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if (event.key === "Tab") {
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
            ),
          );
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header className={cx("focus-scene-header")}>
        <strong>TodoCal</strong>
        <span>A little space for one thing.</span>
        <button
          ref={close}
          onClick={onClose}
          aria-label="Close focus timer — Back to calendar"
          className={cx("", true)}
        >
          <span aria-hidden="true">↗</span> Back to calendar
        </button>
      </header>
      <div className={cx("focus-scene-body")}>
        <p className={cx("eyebrow")}>
          {active?.taskTitle || selectedTask
            ? "CURRENT TASK"
            : "YOUR SPACE TO FOCUS"}
        </p>
        <h2>
          {active
            ? active.taskTitle || kindLabel[active.kind]
            : selectedTask?.title || "One thing at a time."}
        </h2>
        {!active && kind === "focus" && (
          <TimerTaskPicker
            task={task}
            choices={choices}
            selectedTask={selectedTask}
            blocked={focus.blocked}
            focusDate={focusDate}
            onChoose={(id, next) => {
              setSelectedId(id);
              setDurations((old) => ({
                ...old,
                focus: String(next?.focusMinutes ?? settings.focusMinutes),
              }));
              if (!id) onFree();
            }}
          />
        )}
        <div
          className={cx("focus-modes")}
          role="group"
          aria-label="Session mode"
        >
          {(["focus", "short_break", "long_break"] as FocusKind[]).map(
            (mode) => (
              <button
                key={mode}
                disabled={!!active || focus.blocked}
                aria-pressed={currentKind === mode}
                onClick={() => setKind(mode)}
                className={cx("", true)}
              >
                {kindLabel[mode]}
              </button>
            ),
          )}
        </div>
        <label className={cx("focus-duration", true)}>
          Duration{" "}
          <input
            type="number"
            min={1}
            max={180}
            step={1}
            disabled={!!active || focus.blocked}
            value={active ? active.targetSeconds / 60 : durations[kind]}
            onChange={(event) =>
              setDurations({ ...durations, [kind]: event.target.value })
            }
            aria-invalid={!active && !valid}
            className={cx("", true)}
          />{" "}
          min
        </label>
        {!active && !valid && (
          <p role="alert">Enter a whole number from 1 to 180 minutes.</p>
        )}
        <TimerClock
          seconds={seconds}
          ratio={ratio}
          active={active}
          connected={focus.connected}
          settlementPending={focus.query.isFetching}
        />
        <div className={cx("focus-actions")}>
          <button
            className={cx("focus-start", true)}
            disabled={
              focus.blocked ||
              (!active && !valid) ||
              (!!active && seconds === 0)
            }
            onClick={() =>
              void actions.run("primary", () =>
                active
                  ? focus.change(
                      active.status === "paused" ? "resume" : "pause",
                    )
                  : focus.start(kind, selectedTask?.id, minutes),
              )
            }
          >
            {actions.pending === "primary" && focus.connected && (
              <LoadingIndicator />
            )}
            {active
              ? active.status === "paused"
                ? "Resume"
                : "Pause"
              : "Start session"}
          </button>
          {active && (
            <button
              disabled={focus.blocked}
              onClick={() => void actions.run("end", () => focus.change("end"))}
              className={cx("", true)}
            >
              {actions.pending === "end" && focus.connected && (
                <LoadingIndicator />
              )}
              End session
            </button>
          )}
        </div>
        {focus.command.error && <p role="alert">{focus.command.error}</p>}
        {focus.command.uncertain && (
          <button
            disabled={!focus.connected || focus.command.busy}
            onClick={() => void actions.run("retry", focus.retry)}
            className={cx("", true)}
          >
            {actions.pending === "retry" && focus.connected && (
              <LoadingIndicator />
            )}
            Retry timer action
          </button>
        )}
        {focus.query.error && (
          <button
            onClick={() =>
              void actions.run("refresh", () => focus.query.refetch())
            }
            className={cx("", true)}
          >
            {actions.pending === "refresh" && focus.connected && (
              <LoadingIndicator />
            )}
            Refresh timer
          </button>
        )}
        {!active && focus.state?.last && (
          <p role="status" className={cx("focus-session-result")}>
            {focus.state.last.status === "completed"
              ? "Session complete."
              : "Session ended."}{" "}
            {focus.state.last.kind === "focus"
              ? `${Math.floor(focus.state.last.focusSeconds / 60)} min saved · ${focus.state.last.pomodoros} Pomodoro.`
              : "Break saved. Break time does not count as focus."}
          </p>
        )}
        <p className={cx("focus-hint")}>
          One task. No rush. Your progress is saved one step at a time.
        </p>
        <p className={cx("focus-hint")}>
          Completion notifications here work while this tab is open and browser
          permission is granted. Web Push reminders are configured separately in
          Settings → Notifications. Timer sound is a separate setting.
        </p>
        {focus.permission === "default" && (
          <button
            className={cx("focus-free", true)}
            onClick={() =>
              void actions.run("permission", focus.enableNotifications)
            }
          >
            {actions.pending === "permission" && <LoadingIndicator />}Enable
            completion notifications
          </button>
        )}
        {focus.permission === "denied" && (
          <p role="status">
            Notifications are blocked. The timer still works normally.
          </p>
        )}
      </div>
    </section>
  );
}
