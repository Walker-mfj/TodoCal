"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "../../app/providers";
import type { Task, Settings } from "../../lib/model";
import { kindLabel, timerLabel } from "./clock";
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
  const { session, read } = useSession();
  const choices = useQuery({
    queryKey: [session?.user.id, "focus-task-choices"],
    queryFn: async ({ signal }) => {
      const result: Task[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ limit: "100", view: "all" });
        if (cursor) params.set("cursor", cursor);
        const page = await read<{ items: Task[]; nextCursor: string | null }>(
          `/tasks?${params}`,
          { signal, owner: session?.user.id },
        );
        result.push(
          ...page.items.filter((t) => (t.estimatedPomodoros || 0) > 0),
        );
        cursor = page.nextCursor;
      } while (cursor);
      return result;
    },
  });
  const [selectedId, setSelectedId] = useState(
    task?.estimatedPomodoros ? task.id : "",
  );
  const selectedTask =
    choices.data?.find((t) => t.id === selectedId) ||
    (task?.id === selectedId ? task : undefined);
  const [kind, setKind] = useState<FocusKind>(focus.state?.nextKind || "focus");
  const [durations, setDurations] = useState({
    focus: String(settings.focusMinutes),
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
  const currentKind = active?.kind || kind;
  const minutes = Number(durations[currentKind]);
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 180;
  const seconds = active ? focus.remaining : valid ? minutes * 60 : 0;
  const ratio = active ? seconds / active.targetSeconds : 1;
  return (
    <section
      className="focus-panel focus-scene"
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
      <header className="focus-scene-header">
        <strong>TodoCal</strong>
        <span>A little space for one thing.</span>
        <button ref={close} onClick={onClose} aria-label="Close focus timer">
          ↗ Back to calendar
        </button>
      </header>
      <div className="focus-scene-body">
        <p className="eyebrow">
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
          <label className="focus-task-picker">
            Task
            <select
              aria-label="Task"
              value={selectedTask?.id || ""}
              disabled={focus.blocked || choices.isPending}
              onChange={(event) => {
                setSelectedId(event.target.value);
                if (!event.target.value) onFree();
              }}
            >
              <option value="">Free focus · no task</option>
              {choices.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} · {t.estimatedPomodoros} Pomodoro
                </option>
              ))}
            </select>
            {choices.isPending && <small>Loading tasks…</small>}
            {choices.error && (
              <button type="button" onClick={() => void choices.refetch()}>
                Retry loading tasks
              </button>
            )}
            {choices.data?.length === 0 && (
              <small>
                Set estimated Pomodoros on a task to select it here.
              </small>
            )}
          </label>
        )}
        <div className="focus-modes" aria-label="Session mode">
          {(["focus", "short_break", "long_break"] as FocusKind[]).map(
            (mode) => (
              <button
                key={mode}
                disabled={!!active || focus.blocked}
                aria-pressed={currentKind === mode}
                onClick={() => setKind(mode)}
              >
                {kindLabel[mode]}
              </button>
            ),
          )}
        </div>
        <label className="focus-duration">
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
          />{" "}
          min
        </label>
        {!active && !valid && (
          <p role="alert">Enter a whole number from 1 to 180 minutes.</p>
        )}
        <div className="focus-clock">
          <svg viewBox="0 0 360 360" aria-hidden="true">
            <circle cx="180" cy="180" r="170" />
            <circle
              className="focus-arc"
              cx="180"
              cy="180"
              r="170"
              style={{
                strokeDashoffset: 1068 * (1 - Math.max(0, Math.min(1, ratio))),
              }}
            />
          </svg>
          <span role="timer" aria-label="Time remaining">
            {timerLabel(seconds)}
          </span>
          <small>
            {active
              ? active.status === "paused"
                ? "Paused"
                : !focus.connected
                  ? "Offline · estimated"
                  : seconds === 0
                    ? "Confirming completion…"
                    : "Time to focus"
              : "Ready when you are"}
          </small>
        </div>
        <div className="focus-actions">
          <button
            className="focus-start"
            disabled={
              focus.blocked ||
              (!active && !valid) ||
              (!!active && seconds === 0)
            }
            onClick={() =>
              active
                ? focus.change(active.status === "paused" ? "resume" : "pause")
                : focus.start(kind, selectedTask?.id, minutes)
            }
          >
            {active
              ? active.status === "paused"
                ? "Resume"
                : "Pause"
              : "Start session"}
          </button>
          {active && (
            <button
              disabled={focus.blocked}
              onClick={() => focus.change("end")}
            >
              End session
            </button>
          )}
        </div>
        {focus.command.error && <p role="alert">{focus.command.error}</p>}
        {focus.command.uncertain && (
          <button
            disabled={!focus.connected || focus.command.busy}
            onClick={focus.retry}
          >
            Retry timer action
          </button>
        )}
        {focus.query.error && (
          <button onClick={() => void focus.query.refetch()}>
            Refresh timer
          </button>
        )}
        {!active && focus.state?.last && (
          <p role="status" className="focus-session-result">
            {focus.state.last.status === "completed"
              ? "Session complete."
              : "Session ended."}{" "}
            {focus.state.last.kind === "focus"
              ? `${Math.floor(focus.state.last.focusSeconds / 60)} min saved · ${focus.state.last.pomodoros} Pomodoro.`
              : "Break saved. Break time does not count as focus."}
          </p>
        )}
        <p className="focus-hint">
          One task. No rush. Your progress is saved one step at a time.
        </p>
        {focus.permission === "default" && (
          <button
            className="focus-free"
            onClick={() => void focus.enableNotifications()}
          >
            Enable completion notifications
          </button>
        )}
      </div>
    </section>
  );
}
