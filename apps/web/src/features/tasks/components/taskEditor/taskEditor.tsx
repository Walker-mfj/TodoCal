"use client";
import { LoadingIndicator } from "../../../../shared/components/loadingIndicator/loadingIndicator";

import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./taskEditor.module.css";
const cx = bindStyles(styles);

import { SidebarPanel } from "../../../../shared/components/sidebarPanel/sidebarPanel";
import { useConfirm } from "../../../../shared/components/appDialog/appDialog";
import { sessionStore } from "../../../../shared/utils/sessionStorage";
import { ValidatedForm } from "../../../../shared/components/validatedForm/validatedForm";
import { useEffect, useRef, useState } from "react";
import { Repeat2 } from "lucide-react";
import { apiFetch, errorMessage } from "../../../../shared/api/apiClient";
import {
  FieldError,
  sameDraftSchedule,
  taskPayload,
} from "../../utils/taskPayload";
import { type Draft } from "../../types/taskTypes";
import {
  type Task,
  type Group,
  type RecurrenceRule,
} from "../../../../shared/api/domainTypes";
import type { Execute } from "../../../../shared/api/apiClient";
import { useTaskDraft } from "../../hooks/useTaskDraft";
import { useTaskSave } from "../../hooks/useTaskSave";
import {
  TaskContentFields,
  TaskScheduleFields,
  TaskRecurrenceFields,
  TaskFocusFields,
} from "./taskEditorFields";
import { RecurrenceScopeDialog } from "./recurrenceScopeDialog";
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
  onDraftChange?: (draft: Draft) => void;
  onStateChange?: (state: { dirty: boolean; blocked: boolean }) => void;
}) {
  const confirm = useConfirm();
  const [scopePrompt, setScopePrompt] = useState(false);
  const [seriesError, setSeriesError] = useState("");
  const [seriesRule, setSeriesRule] = useState<RecurrenceRule | null>(null);
  const lastSeed = useRef(seed);
  const {
    draft,
    setDraft,
    baseline,
    setBaseline,
    planFocus,
    setPlanFocus,
    ready,
    baseRevision,
    pending,
    setPending,
    seriesRevision,
    setSeriesRevision,
    storageKey,
    dirty,
  } = useTaskDraft({ owner, task, zone, seed, defaultFocusMinutes });
  const { save, busy, error, setError, conflict, fieldError, setFieldError } =
    useTaskSave({
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
    });
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
  }, [task?.seriesId, ready, owner, seriesRule, setSeriesRevision]);
  useEffect(() => {
    if (ready) onDraftChange?.(draft);
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
      scheduledEndDate: seed.scheduledEndDate || "",
      startTime: seed.startTime || "",
      endTime: seed.endTime || "",
    };
    setDraft((previous) => ({ ...previous, ...schedule }));
    // Picking the initial slot is not an edit to the task's content.
    if (!task) setBaseline((previous) => ({ ...previous, ...schedule }));
    setError("");
    setFieldError(null);
  }, [
    seed,
    ready,
    task,
    busy,
    pending,
    setDraft,
    setBaseline,
    setError,
    setFieldError,
  ]);

  const change = (key: keyof Draft, value: string | number) => {
    setDraft((d) => ({
      ...d,
      [key]:
        key === "scheduledEndDate" && value === d.scheduledDate ? "" : value,
      ...((key === "startTime" && !value && !d.endTime) ||
      (key === "endTime" && !value && !d.startTime)
        ? { scheduledEndDate: "" }
        : {}),
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
            if (!pending)
              taskPayload(draft, zone, {
                unchangedSchedule: !!task && sameDraftSchedule(draft, baseline),
                editing: !!task,
                previousTask: task,
              });
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
          <TaskContentFields draft={draft} change={change} groups={groups} />
          <TaskScheduleFields draft={draft} change={change} zone={zone} />
          <TaskRecurrenceFields
            draft={draft}
            change={change}
            task={task}
            seriesRule={seriesRule}
          />
          <TaskFocusFields
            draft={draft}
            change={change}
            planFocus={planFocus}
            defaultFocusMinutes={defaultFocusMinutes}
            onPlanFocusChange={(checked) => {
              setPlanFocus(checked);
              setDraft((d) => ({
                ...d,
                estimatedPomodoros: checked ? "1" : "",
                focusMinutes: checked
                  ? d.focusMinutes || String(defaultFocusMinutes)
                  : "",
              }));
              setFieldError(null);
            }}
          />
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
          data-pending-control="true"
          aria-busy={Boolean(busy)}
        >
          <span data-button-content="true">
            {busy ? (
              <>
                <LoadingIndicator />
                Saving…
              </>
            ) : pending ? (
              "Retry save"
            ) : task ? (
              "Save changes"
            ) : (
              "Create task"
            )}
          </span>
          <span aria-hidden="true" data-button-reserve="true">
            Saving…
          </span>
          <span aria-hidden="true" data-button-reserve="true">
            Retry save
          </span>
          <span aria-hidden="true" data-button-reserve="true">
            Save changes
          </span>
          <span aria-hidden="true" data-button-reserve="true">
            Create task
          </span>
        </button>
      </ValidatedForm>
      {scopePrompt && (
        <RecurrenceScopeDialog
          task={task}
          draft={draft}
          seriesRevision={seriesRevision}
          seriesError={seriesError}
          onDismiss={() => setScopePrompt(false)}
          onSave={(scope) => void save(scope)}
        />
      )}
    </SidebarPanel>
  );
}
