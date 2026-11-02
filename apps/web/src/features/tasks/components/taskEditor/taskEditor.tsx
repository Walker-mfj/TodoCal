"use client";
import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./taskEditor.module.css";
const cx = bindStyles(styles);

import { SidebarPanel } from "../../../../shared/components/sidebarPanel/sidebarPanel";
import { Dialog } from "../../../../shared/components/dialog/dialog";
import { priorityLabels } from "../../constants/taskConstants";
import type { CalendarDraft } from "../../../calendar/utils/draftPreview";
import { useConfirm } from "../../../../shared/components/appDialog/appDialog";
import { sessionStore } from "../../../../shared/utils/sessionStorage";
import { ValidatedForm } from "../../../../shared/components/validatedForm/validatedForm";
import { useEffect, useRef, useState } from "react";
import { Repeat2 } from "lucide-react";
import {
  apiFetch,
  ApiError,
  errorMessage,
  type RequestOptions,
} from "../../../../shared/api/apiClient";
import {
  FieldError,
  draftFromTask,
  taskPayload,
} from "../../utils/taskPayload";
import { recurrenceSummary } from "../../utils/recurrenceSummary";
import { type Draft } from "../../types/taskTypes";
import {
  type Task,
  type Group,
  type RecurrenceRule,
} from "../../../../shared/api/domainTypes";
import type { Execute } from "../../../../shared/api/apiClient";
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
  defaultFocusMinutes = 25,
}: {
  defaultFocusMinutes?: number;
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
  const [seriesRevision, setSeriesRevision] = useState<number | null>(null);
  const [seriesError, setSeriesError] = useState("");
  const [seriesRule, setSeriesRule] = useState<RecurrenceRule | null>(null);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const initial = useRef<Draft>(
    task
      ? {
          ...draftFromTask(task, zone),
          ...(task.estimatedPomodoros && !task.focusMinutes
            ? { focusMinutes: String(defaultFocusMinutes) }
            : {}),
        }
      : { title: "", ...seed },
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
    task
      ? {
          ...draftFromTask(task, zone),
          ...(task.estimatedPomodoros && !task.focusMinutes
            ? { focusMinutes: String(defaultFocusMinutes) }
            : {}),
        }
      : { title: "", ...seed },
  );
  const [planFocus, setPlanFocus] = useState(
    !!(task?.estimatedPomodoros || seed?.estimatedPomodoros),
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
        setPlanFocus(!!parsed.draft.estimatedPomodoros);
        setBaseline(parsed.baseline || initial.current);
        setPending(parsed.pending || null);
        setSeriesRevision(parsed.seriesRevision ?? null);
        setBaseRevision(parsed.baseRevision ?? task?.revision);
      }
    } catch {}
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!task?.seriesId || !ready || seriesRule !== null) return;
    let active = true;
    apiFetch<RecurrenceRule & { revision: number }>(
      `/series/${task.seriesId}`,
      { owner },
    )
      .then((data) => {
        if (active) {
          setSeriesRevision((previous) => previous ?? data.revision);
          setSeriesRule(data);
        }
      })
      .catch((e) => {
        if (active) setSeriesError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [task?.seriesId, ready, owner, seriesRule]);
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
        ? {
            intervalDays:
              seriesRule?.cadence === "interval" ? seriesRule.intervalDays : 2,
          }
        : {}),
    }));
    setError("");
    setFieldError(null);
  };
  const close = async () => {
    if (
      dirty &&
      !(await confirm("Unsaved changes will be discarded.", {
        title: "Discard unsaved changes?",
        confirmLabel: "Discard changes",
        destructive: true,
        cancelLabel: "Keep editing",
      }))
    )
      return;
    sessionStore.removeItem(storageKey);
    onClose();
  };
  const save = async (scope: "one" | "following" = "one") => {
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
                        ...(scope === "following"
                          ? {
                              expectedSeriesRevision: seriesRevision,
                              ...(draft.cadence
                                ? {
                                    recurrence: {
                                      cadence: draft.cadence,
                                      intervalDays:
                                        draft.cadence === "weekly"
                                          ? 7
                                          : draft.cadence === "daily"
                                            ? 1
                                            : draft.intervalDays ||
                                              seriesRule?.intervalDays ||
                                              2,
                                      endDate:
                                        draft.endDate === undefined
                                          ? (seriesRule?.endDate ?? null)
                                          : draft.endDate || null,
                                    },
                                  }
                                : {}),
                            }
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
              : /focus.*minutes|focus duration/i.test(e.message)
                ? "focusMinutes"
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
    <SidebarPanel
      className={cx("task-editor")}
      label={task ? "Edit task" : "New task"}
      title={task ? "Edit task" : "New task"}
      eyebrow={task ? "TASK DETAILS" : "MAKE A LITTLE ROOM"}
      closeLabel="Close editor"
      disabled={busy || !ready}
      onClose={close}
    >
      {task?.seriesId && (
        <p className={cx("notice")}>
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
        <fieldset
          disabled={busy || !!pending || disabled || !ready}
          className={cx("", true)}
        >
          <label className={cx("", true)}>
            Task title
            <input
              autoFocus
              required
              maxLength={300}
              name="title"
              value={draft.title}
              onChange={(e) => change("title", e.target.value)}
              placeholder="What would you like to do?"
              className={cx("", true)}
            />
          </label>
          <label className={cx("", true)}>
            Description
            <textarea
              rows={3}
              maxLength={10000}
              name="description"
              value={draft.description || ""}
              onChange={(e) => change("description", e.target.value)}
              placeholder="A few helpful details…"
              className={cx("", true)}
            />
          </label>
          <div className={cx("form-row")}>
            <label className={cx("", true)}>
              Group
              <select
                name="groupId"
                value={draft.groupId || ""}
                onChange={(e) => change("groupId", e.target.value)}
                className={cx("", true)}
              >
                <option value="">No group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={cx("", true)}>
              Priority
              <select
                name="priority"
                value={draft.priority || "medium"}
                onChange={(e) => change("priority", e.target.value)}
                className={cx("", true)}
              >
                {(["low", "medium", "high"] as const).map((p) => (
                  <option key={p} value={p}>
                    {priorityLabels[p]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={cx("", true)}>
            Scheduled date
            <input
              type="date"
              name="scheduledDate"
              value={draft.scheduledDate || ""}
              onChange={(e) => change("scheduledDate", e.target.value)}
              className={cx("", true)}
            />
          </label>
          <div className={cx("form-row")}>
            <label className={cx("", true)}>
              Start time
              <input
                type="time"
                name="startTime"
                value={draft.startTime || ""}
                onChange={(e) => change("startTime", e.target.value)}
                className={cx("", true)}
              />
            </label>
            <label className={cx("", true)}>
              End time
              <input
                type="time"
                name="endTime"
                value={draft.endTime || ""}
                onChange={(e) => change("endTime", e.target.value)}
                className={cx("", true)}
              />
            </label>
          </div>
          <small>
            Leave times empty for an untimed task. Times use {zone}.
          </small>
          <label className={cx("", true)}>
            Deadline (optional)
            <input
              type="datetime-local"
              name="deadline"
              value={draft.deadline || ""}
              onChange={(e) => change("deadline", e.target.value)}
              className={cx("", true)}
            />
          </label>
          {(!task || task.seriesId) && (
            <>
              <label className={cx("", true)}>
                Repeat
                <select
                  name="cadence"
                  value={draft.cadence || seriesRule?.cadence || "none"}
                  onChange={(e) => change("cadence", e.target.value)}
                  className={cx("", true)}
                >
                  {!task && <option value="none">Does not repeat</option>}
                  <option value="daily">Daily</option>
                  <option value="interval">Every N days</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
              {(draft.cadence || seriesRule?.cadence) &&
                draft.cadence !== "none" && (
                  <>
                    {(draft.cadence || seriesRule?.cadence) === "interval" && (
                      <label className={cx("", true)}>
                        Every (days)
                        <input
                          type="number"
                          min={2}
                          max={365}
                          name="intervalDays"
                          value={
                            draft.intervalDays || seriesRule?.intervalDays || 2
                          }
                          onChange={(e) => {
                            change("intervalDays", Number(e.target.value));
                            if (task && !draft.cadence && seriesRule)
                              change("cadence", seriesRule.cadence);
                          }}
                          className={cx("", true)}
                        />
                      </label>
                    )}
                    <label className={cx("", true)}>
                      Repeat until (inclusive)
                      <input
                        type="date"
                        min={draft.scheduledDate}
                        name="endDate"
                        value={draft.endDate ?? seriesRule?.endDate ?? ""}
                        onChange={(e) => {
                          change("endDate", e.target.value);
                          if (task && !draft.cadence && seriesRule)
                            change("cadence", seriesRule.cadence);
                        }}
                        className={cx("", true)}
                      />
                    </label>
                    <p className={cx("recurrence-summary")}>
                      {recurrenceSummary(
                        draft.cadence || seriesRule?.cadence || "none",
                        draft.intervalDays || seriesRule?.intervalDays || 2,
                        draft.endDate ?? seriesRule?.endDate ?? undefined,
                      )}
                    </p>
                  </>
                )}
            </>
          )}
          <label className={cx("checkbox-label", true)}>
            <input
              type="checkbox"
              checked={planFocus}
              onChange={(e) => {
                setPlanFocus(e.target.checked);
                setDraft((d) => ({
                  ...d,
                  estimatedPomodoros: e.target.checked ? "1" : "",
                  focusMinutes: e.target.checked
                    ? d.focusMinutes || String(defaultFocusMinutes)
                    : "",
                }));
                setFieldError(null);
              }}
              className={cx("", true)}
            />
            Plan focus
          </label>
          {planFocus && (
            <>
              <div className={cx("form-row")}>
                <label className={cx("", true)}>
                  Planned Pomodoros
                  <input
                    type="number"
                    required
                    min={1}
                    max={2147483647}
                    name="estimatedPomodoros"
                    value={draft.estimatedPomodoros}
                    onChange={(e) =>
                      change("estimatedPomodoros", e.target.value)
                    }
                    className={cx("", true)}
                  />
                </label>
                <label className={cx("", true)}>
                  Session length (minutes)
                  <input
                    type="number"
                    required
                    min={1}
                    max={180}
                    name="focusMinutes"
                    value={draft.focusMinutes ?? String(defaultFocusMinutes)}
                    onChange={(e) => change("focusMinutes", e.target.value)}
                    className={cx("", true)}
                  />
                </label>
              </div>
              <p>
                Planned Focus Time:{" "}
                {Number(draft.estimatedPomodoros) *
                  Number(draft.focusMinutes ?? defaultFocusMinutes)}{" "}
                min
              </p>
              <small>
                Focus time is separate from your calendar schedule. Completing
                focus does not complete the task.
              </small>
            </>
          )}
        </fieldset>
        {error && (
          <p role="alert" className={cx("error")}>
            {error}
          </p>
        )}
        {pending && !busy && (
          <p className={cx("notice")}>
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
            className={cx("", true)}
          >
            Discard draft and reload
          </button>
        )}
        <button
          className={cx("primary wide", true)}
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
        <Dialog
          title="Edit repeating task"
          icon={Repeat2}
          onDismiss={() => setScopePrompt(false)}
          description={`Change this task and future repetitions starting ${task?.originalOccurrenceDate || task?.scheduledDate}. Earlier repetitions stay unchanged. Completed or focused tasks retain their accepted values. Recurrence rule changes require This and following.`}
          actions={
            <>
              <button
                type="button"
                disabled={!!draft.cadence}
                onClick={() => void save("one")}
                className={cx("", true)}
              >
                This occurrence
              </button>
              <button
                type="button"
                className={cx("primary", true)}
                disabled={
                  seriesRevision === null ||
                  task?.status === "complete" ||
                  !!task?.actualFocusSeconds
                }
                onClick={() => void save("following")}
              >
                This and following
              </button>
            </>
          }
        >
          {seriesError && (
            <p role="alert" className={cx("error")}>
              {seriesError}
            </p>
          )}
        </Dialog>
      )}
    </SidebarPanel>
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
