"use client";
import type { CalendarDraft } from "../calendar/draft-preview";
import { useConfirm } from "../../components/app-dialog";
import { sessionStore } from "../../lib/session-storage";
import { ValidatedForm } from "../../components/validated-form";
import { useEffect, useRef, useState } from "react";
import { X, Repeat2 } from "lucide-react";
import {
  apiFetch,
  ApiError,
  errorMessage,
  type RequestOptions,
} from "../../lib/api";
import {
  FieldError,
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
  onStateChange,
  onDraftChange,
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
  onDraftChange?: (preview: CalendarDraft) => void;
  onStateChange?: (state: { dirty: boolean; blocked: boolean }) => void;
}) {
  const confirm = useConfirm();
  const [scopePrompt, setScopePrompt] = useState(false);
  const scopeDialog = useRef<HTMLDialogElement>(null);
  const [seriesRevision, setSeriesRevision] = useState<number | null>(null);
  const [seriesError, setSeriesError] = useState("");
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const initial = useRef<Draft>(
    task ? draftFromTask(task, zone) : { title: "", ...seed },
  );
  const [baseline, setBaseline] = useState(initial.current);
  const lastSeed = useRef(seed);
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
      const saved = sessionStore.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        setDraft(
          !task && seed && !parsed.pending
            ? {
                ...parsed.draft,
                scheduledDate: seed.scheduledDate || "",
                startTime: seed.startTime || "",
                endTime: seed.endTime || "",
              }
            : parsed.draft,
        );
        setBaseline(parsed.baseline || initial.current);
        setPending(parsed.pending || null);
        setSeriesRevision(parsed.seriesRevision ?? null);
        setBaseRevision(parsed.baseRevision ?? task?.revision);
      }
    } catch {}
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!task?.seriesId || !ready || seriesRevision !== null) return;
    let active = true;
    apiFetch<{ revision: number }>(`/series/${task.seriesId}`, { owner })
      .then((data) => {
        if (active) setSeriesRevision(data.revision);
      })
      .catch((e) => {
        if (active) setSeriesError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [task?.seriesId, ready, owner, seriesRevision]);
  useEffect(() => {
    if (scopePrompt) scopeDialog.current?.showModal();
  }, [scopePrompt]);
  const dirty = fingerprint(draft) !== fingerprint(baseline) || !!pending;
  useEffect(() => {
    if (!ready) return;
    if (!dirty) {
      sessionStore.removeItem(storageKey);
      return;
    }
    sessionStore.setItem(
      storageKey,
      JSON.stringify({
        draft,
        pending,
        baseRevision,
        baseline,
        seriesRevision,
      }),
    );
  }, [
    draft,
    pending,
    baseRevision,
    baseline,
    ready,
    storageKey,
    dirty,
    seriesRevision,
  ]);

  useEffect(() => {
    if (ready) onDraftChange?.({ draft, taskId: task?.id });
  }, [draft, task?.id, ready, onDraftChange]);

  useEffect(() => {
    onStateChange?.({ dirty, blocked: busy || !!pending });
  }, [dirty, busy, pending, onStateChange]);

  useEffect(() => {
    if (seed === lastSeed.current) return;
    lastSeed.current = seed;
    if (!ready || !seed || busy || pending) return;
    const schedule = {
      scheduledDate: seed.scheduledDate || "",
      startTime: seed.startTime || "",
      endTime: seed.endTime || "",
    };
    setDraft((previous) => ({ ...previous, ...schedule }));
    // Picking the initial slot is not an edit to the task's content.
    if (!task) setBaseline((previous) => ({ ...previous, ...schedule }));
    setError("");
    setFieldError(null);
  }, [seed, ready, task, busy, pending]);

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
    setFieldError(null);
  };
  const close = async () => {
    if (
      dirty &&
      !(await confirm("Unsaved changes will be discarded.", {
        title: "Close editor?",
        confirmLabel: "Close editor",
        cancelLabel: "Keep editing",
      }))
    )
      return;
    sessionStore.removeItem(storageKey);
    onClose();
  };
  const save = async (scope: "one" | "all" = "one") => {
    setScopePrompt(false);
    setError("");
    setFieldError(null);
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
              ? {
                  ...input,
                  expectedRevision: baseRevision,
                  ...(task.seriesId
                    ? {
                        scope,
                        ...(scope === "all"
                          ? { expectedSeriesRevision: seriesRevision }
                          : {}),
                      }
                    : {}),
                }
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
        sessionStore.setItem(
          storageKey,
          JSON.stringify({
            draft,
            pending: command,
            baseRevision,
            baseline,
            seriesRevision,
          }),
        );
      }
      await execute(command.path, command.options);
      // Navigation can unmount this editor while saving. Clear only this command,
      // never a newer draft opened in the meantime.
      try {
        const stored = JSON.parse(sessionStore.getItem(storageKey) || "null");
        if (stored?.pending?.options?.key === command.options.key)
          sessionStore.removeItem(storageKey);
      } catch {}
      if (!mounted.current) return;
      onSaved(task ? undefined : draft);
    } catch (e) {
      if (e instanceof FieldError) setFieldError(e);
      else if (e instanceof ApiError && e.status === 422) {
        const field = /title/i.test(e.message)
          ? "title"
          : /description/i.test(e.message)
            ? "description"
            : /priority/i.test(e.message)
              ? "priority"
              : /pomodoro/i.test(e.message)
                ? "estimatedPomodoros"
                : /deadline/i.test(e.message)
                  ? "deadline"
                  : /end time|both start/i.test(e.message)
                    ? "endTime"
                    : /local time|HH:mm/i.test(e.message)
                      ? "startTime"
                      : /date|daily plan/i.test(e.message)
                        ? "scheduledDate"
                        : null;
        if (field) setFieldError(new FieldError(field, e.message));
        else setError(errorMessage(e));
      } else setError(errorMessage(e));
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
      className="detail-panel task-editor"
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
          <Repeat2 size={14} /> When saving, choose this occurrence or all
          current and future occurrences.
        </p>
      )}
      <ValidatedForm
        fieldError={fieldError}
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (!pending) taskPayload(draft, zone);
            if (task?.seriesId && !pending) setScopePrompt(true);
            else void save();
          } catch (e) {
            if (e instanceof FieldError) setFieldError(e);
            else setError(errorMessage(e));
          }
        }}
      >
        <fieldset disabled={busy || !!pending || disabled || !ready}>
          <label>
            Task title
            <input
              autoFocus
              required
              maxLength={300}
              name="title"
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
              name="description"
              value={draft.description || ""}
              onChange={(e) => change("description", e.target.value)}
              placeholder="A few helpful details…"
            />
          </label>
          <div className="form-row">
            <label>
              Group
              <select
                name="groupId"
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
                name="priority"
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
              name="scheduledDate"
              value={draft.scheduledDate || ""}
              onChange={(e) => change("scheduledDate", e.target.value)}
            />
          </label>
          <div className="form-row">
            <label>
              Start time
              <input
                type="time"
                name="startTime"
                value={draft.startTime || ""}
                onChange={(e) => change("startTime", e.target.value)}
              />
            </label>
            <label>
              End time
              <input
                type="time"
                name="endTime"
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
              name="deadline"
              value={draft.deadline || ""}
              onChange={(e) => change("deadline", e.target.value)}
            />
          </label>
          {!task && (
            <>
              <label>
                Repeat
                <select
                  name="cadence"
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
                        name="intervalDays"
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
                      name="endDate"
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
              name="estimatedPomodoros"
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
            onClick={async () => {
              if (
                await confirm("Replace this draft with the latest task?", {
                  title: "Discard local changes?",
                  confirmLabel: "Discard and reload",
                  destructive: true,
                })
              ) {
                sessionStore.removeItem(storageKey);
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
      {scopePrompt && (
        <dialog
          ref={scopeDialog}
          className="app-dialog"
          aria-labelledby="recurring-edit-title"
          onCancel={() => setScopePrompt(false)}
        >
          <div className="app-dialog-heading">
            <h2 id="recurring-edit-title">Edit repeating task</h2>
          </div>
          <p>
            Apply changes to this occurrence, or all occurrences from today
            onward? Finalized history stays unchanged. Date changes shift the
            other occurrences by the same number of days.
          </p>
          {seriesError && (
            <p role="alert" className="error">
              {seriesError}
            </p>
          )}
          <div className="app-dialog-actions">
            <button
              type="button"
              autoFocus
              onClick={() => setScopePrompt(false)}
            >
              Cancel
            </button>
            <button type="button" onClick={() => void save("one")}>
              This occurrence
            </button>
            <button
              type="button"
              className="primary"
              disabled={seriesRevision === null}
              onClick={() => void save("all")}
            >
              All occurrences
            </button>
          </div>
        </dialog>
      )}
    </aside>
  );
}

function fingerprint(draft: Draft) {
  const normalized = {
    ...draft,
    priority: draft.priority || "medium",
    cadence: draft.cadence || "none",
  };
  return JSON.stringify(
    Object.entries(normalized)
      .filter(
        ([key, value]) =>
          value !== undefined &&
          value !== "" &&
          !(key === "intervalDays" && normalized.cadence !== "interval"),
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
