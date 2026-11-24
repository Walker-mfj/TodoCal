"use client";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ApiError,
  errorMessage,
  type Execute,
} from "../../../shared/api/apiClient";
import { sessionStore } from "../../../shared/utils/sessionStorage";
import {
  FieldError,
  sameDraftSchedule,
  taskPayload,
} from "../utils/taskPayload";
import type { Draft } from "../types/taskTypes";
import type { Task, RecurrenceRule } from "../../../shared/api/domainTypes";
import type { Pending } from "./useTaskDraft";

export function useTaskSave({
  task,
  draft,
  baseline,
  zone,
  pending,
  setPending,
  baseRevision,
  seriesRevision,
  seriesRule,
  storageKey,
  execute,
  onSaved,
  setScopePrompt,
}: {
  task?: Task;
  draft: Draft;
  baseline: Draft;
  zone: string;
  pending: Pending | null;
  setPending: Dispatch<SetStateAction<Pending | null>>;
  baseRevision?: number;
  seriesRevision: number | null;
  seriesRule: RecurrenceRule | null;
  storageKey: string;
  execute: Execute;
  onSaved: (created?: Draft) => void;
  setScopePrompt: (open: boolean) => void;
}) {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const save = async (scope: "one" | "following" = "one") => {
    setScopePrompt(false);
    setError("");
    setFieldError(null);
    setBusy(true);
    try {
      let command = pending;
      if (!command) {
        const scheduleUnchanged = !!task && sameDraftSchedule(draft, baseline);
        const input = taskPayload(draft, zone, {
          unchangedSchedule: scheduleUnchanged,
          editing: !!task,
          previousTask: task,
        });
        const {
          scheduledDate,
          scheduledEndDate,
          startTime,
          endTime,
          ...content
        } = input;
        // Following edits are patches: unchanged form values must not overwrite
        // individually customized sibling occurrences.
        const original =
          task && scope === "following"
            ? taskPayload(baseline, zone, {
                unchangedSchedule: true,
                editing: true,
                previousTask: task,
              })
            : null;
        const patch = original
          ? Object.fromEntries(
              Object.entries(input).filter(
                ([key, value]) =>
                  value !== original[key as keyof typeof original] ||
                  (key === "scheduledEndDate" &&
                    !!scheduledEndDate &&
                    scheduledDate !== original.scheduledDate),
              ),
            )
          : scheduleUnchanged
            ? content
            : {
                ...content,
                scheduledDate,
                scheduledEndDate,
                startTime,
                endTime,
              };
        if (task && draft.deadline === baseline.deadline) delete patch.deadline;
        const repeating = !task && draft.cadence && draft.cadence !== "none";
        command = {
          path: task ? `/tasks/${task.id}` : repeating ? "/series" : "/tasks",
          options: {
            method: task ? "PATCH" : "POST",
            key: crypto.randomUUID(),
            body: task
              ? {
                  ...patch,
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
                    : /scheduled end date/i.test(e.message)
                      ? "scheduledEndDate"
                      : /end time|end must|both start/i.test(e.message)
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
  return { save, busy, error, setError, conflict, fieldError, setFieldError };
}
