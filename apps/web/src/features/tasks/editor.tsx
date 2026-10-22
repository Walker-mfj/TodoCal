"use client";
import { ValidatedForm } from "../../components/validated-form";
import { useEffect, useRef, useState } from "react";
import { X, Repeat2 } from "lucide-react";
import { ApiError, errorMessage, type RequestOptions } from "../../lib/api";
import {
  draftFromTask,
  recurrenceSummary,
  taskPayload,
  type Draft,
  type Task,
  type Group,
} from "../../lib/model";
import type { Execute } from "../../app/providers";
type Pending = { path: string; options: RequestOptions };
export function TaskEditor({
  owner,
  zone,
  groups,
  task,
  seed,
  disabled,
  execute,
  onSaved,
  onClose,
}: {
  owner: string;
  zone: string;
  groups: Group[];
  task?: Task;
  seed?: Partial<Draft>;
  disabled: boolean;
  execute: Execute;
  onSaved: (created?: Draft) => void;
  onClose: () => void;
}) {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const storageKey = `focus:draft:${owner}:${task?.id || "new"}`;
  const [draft, setDraft] = useState<Draft>(
    task ? draftFromTask(task, zone) : { title: "", ...seed },
  );
  const [ready, setReady] = useState(false);
  const [baseRevision, setBaseRevision] = useState(task?.revision);
  const [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        setDraft(parsed.draft);
        setPending(parsed.pending || null);
        setBaseRevision(parsed.baseRevision ?? task?.revision);
      }
    } catch {}
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (ready)
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ draft, pending, baseRevision }),
      );
  }, [draft, pending, baseRevision, ready, storageKey]);
  const change = (key: keyof Draft, value: string | number) => {
    setDraft((d) => ({
      ...d,
      [key]: value,
      ...(key === "cadence" &&
      value === "interval" &&
      d.intervalDays === undefined
        ? { intervalDays: 2 }
        : {}),
    }));
    setError("");
  };
  const close = () => {
    if ((draft.title || pending) && !window.confirm("Discard this draft?"))
      return;
    sessionStorage.removeItem(storageKey);
    onClose();
  };
  const save = async () => {
    setError("");
    setBusy(true);
    try {
      let command = pending;
      if (!command) {
        const input = taskPayload(draft, zone);
        const repeating = !task && draft.cadence && draft.cadence !== "none";
        command = {
          path: task ? `/tasks/${task.id}` : repeating ? "/series" : "/tasks",
          options: {
            method: task ? "PATCH" : "POST",
            key: crypto.randomUUID(),
            body: task
              ? { ...input, expectedRevision: baseRevision }
              : repeating
                ? {
                    task: input,
                    cadence: draft.cadence,
                    intervalDays:
                      draft.cadence === "interval"
                        ? draft.intervalDays
                        : draft.cadence === "weekly"
                          ? 7
                          : 1,
                    endDate: draft.endDate || null,
                  }
                : input,
          },
        };
        setPending(command);
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ draft, pending: command, baseRevision }),
        );
      }
      await execute(command.path, command.options);
      if (!mounted.current) return;
      sessionStorage.removeItem(storageKey);
      onSaved(task ? undefined : draft);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status !== 401 && e.status < 500) {
        setPending(null);
        if (e.status === 409) setConflict(true);
      } else if (!(e instanceof ApiError) && !(e instanceof TypeError)) {
        setPending(null);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside
      className="detail-panel"
      aria-label={task ? "Edit task" : "New task"}
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            {task ? "TASK DETAILS" : "MAKE A LITTLE ROOM"}
          </p>
          <h2>{task ? "Edit task" : "New task"}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close editor"
          disabled={busy}
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      {task?.seriesId && (
        <p className="notice">
          <Repeat2 size={14} /> Changes apply to this occurrence only.
        </p>
      )}
      <ValidatedForm
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy || !!pending || disabled || !ready}>
          <label>
            Task title
            <input
              autoFocus
              required
              maxLength={300}
              value={draft.title}
              onChange={(e) => change("title", e.target.value)}
              placeholder="What would you like to do?"
            />
          </label>
          <label>
            Description
            <textarea
              rows={3}
              maxLength={10000}
              value={draft.description || ""}
              onChange={(e) => change("description", e.target.value)}
              placeholder="A few helpful details…"
            />
          </label>
          <div className="form-row">
            <label>
              Group
              <select
                value={draft.groupId || ""}
                onChange={(e) => change("groupId", e.target.value)}
              >
                <option value="">No group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={draft.priority || "medium"}
                onChange={(e) => change("priority", e.target.value)}
              >
                {["low", "medium", "high"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Scheduled date
            <input
              type="date"
              value={draft.scheduledDate || ""}
              onChange={(e) => change("scheduledDate", e.target.value)}
            />
          </label>
          <div className="form-row">
            <label>
              Start time
              <input
                type="time"
                value={draft.startTime || ""}
                onChange={(e) => change("startTime", e.target.value)}
              />
            </label>
            <label>
              End time
              <input
                type="time"
                value={draft.endTime || ""}
                onChange={(e) => change("endTime", e.target.value)}
              />
            </label>
          </div>
          <small>
            Leave times empty for an untimed task. Times use {zone}.
          </small>
          <label>
            Deadline (optional)
            <input
              type="datetime-local"
              value={draft.deadline || ""}
              onChange={(e) => change("deadline", e.target.value)}
            />
          </label>
          {!task && (
            <>
              <label>
                Repeat
                <select
                  value={draft.cadence || "none"}
                  onChange={(e) => change("cadence", e.target.value)}
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="interval">Every N days</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
              {draft.cadence && draft.cadence !== "none" && (
                <>
                  {draft.cadence === "interval" && (
                    <label>
                      Every (days)
                      <input
                        type="number"
                        min={2}
                        max={365}
                        value={draft.intervalDays || 2}
                        onChange={(e) =>
                          change("intervalDays", Number(e.target.value))
                        }
                      />
                    </label>
                  )}
                  <label>
                    Repeat until (inclusive)
                    <input
                      type="date"
                      min={draft.scheduledDate}
                      value={draft.endDate || ""}
                      onChange={(e) => change("endDate", e.target.value)}
                    />
                  </label>
                  <p className="recurrence-summary">
                    {recurrenceSummary(
                      draft.cadence,
                      draft.intervalDays || 2,
                      draft.endDate,
                    )}
                  </p>
                </>
              )}
            </>
          )}
          <label>
            Estimated Pomodoros (optional)
            <input
              type="number"
              min={1}
              max={2147483647}
              value={draft.estimatedPomodoros || ""}
              onChange={(e) => change("estimatedPomodoros", e.target.value)}
              placeholder="No timer needed"
            />
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {pending && !busy && (
          <p className="notice">
            This save has not been confirmed. Retry the same request to avoid
            duplicates.
          </p>
        )}
        {conflict && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Replace this draft with the latest task?")) {
                sessionStorage.removeItem(storageKey);
                onSaved();
              }
            }}
          >
            Discard draft and reload
          </button>
        )}
        <button
          className="primary wide"
          disabled={busy || disabled || conflict || !ready}
        >
          {busy
            ? "Saving…"
            : pending
              ? "Retry save"
              : task
                ? "Save changes"
                : "Create task"}
        </button>
      </ValidatedForm>
    </aside>
  );
}
