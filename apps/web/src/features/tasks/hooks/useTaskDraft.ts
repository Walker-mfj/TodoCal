"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { sessionStore } from "../../../shared/utils/sessionStorage";
import { draftFromTask } from "../utils/taskPayload";
import type { Draft } from "../types/taskTypes";
import type { Task } from "../../../shared/api/domainTypes";
import type { RequestOptions } from "../../../shared/api/apiClient";
export type Pending = { path: string; options: RequestOptions };

export function useTaskDraft({
  owner,
  task,
  zone,
  seed,
  defaultFocusMinutes,
}: {
  owner: string;
  task?: Task;
  zone: string;
  seed?: Partial<Draft>;
  defaultFocusMinutes: number;
}) {
  const [seriesRevision, setSeriesRevision] = useState<number | null>(null);
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
  const [pending, setPending] = useState<Pending | null>(null);
  const restore = useEffectEvent((key: string) => {
    try {
      const saved = sessionStore.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        setDraft(
          !task && seed && !parsed.pending
            ? {
                ...parsed.draft,
                scheduledDate: seed.scheduledDate || "",
                scheduledEndDate: seed.scheduledEndDate || "",
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
  });
  useEffect(() => {
    restore(storageKey);
  }, [storageKey]);
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

  return {
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
  };
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
