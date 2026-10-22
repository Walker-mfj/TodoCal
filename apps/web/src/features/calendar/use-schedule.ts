"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "../../app/providers";
import { ApiError, errorMessage, type RequestOptions } from "../../lib/api";
import type { Task } from "../../lib/model";
import type { components } from "../../lib/api-types";
import type { Schedule } from "./interactions";
type Command = {
  path: string;
  options: RequestOptions;
  kind: "schedule" | "undo";
  label: string;
};
type Toast = { label: string; id: string; deadline: number };
export function useSchedule() {
  const { session, execute, connected } = useSession();
  const key = `focus:command:${session!.user.id}:schedule`;
  const [pending, setPending] = useState<Command | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState<Toast | null>(null);
  const mounted = useRef(false),
    inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) {
        setPending(JSON.parse(saved));
        setError(
          "A calendar change is unconfirmed. Retry to check its result.",
        );
      }
    } catch {}
    return () => {
      mounted.current = false;
    };
  }, [key]);
  async function run(command: Command) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setPending(command);
    sessionStorage.setItem(key, JSON.stringify(command));
    let responseTime = Date.now();
    let receivedAt = performance.now();
    try {
      const result = await execute<
        components["schemas"]["ScheduledTask"] | Task
      >(command.path, {
        ...command.options,
        onResponse: (response) => {
          receivedAt = performance.now();
          responseTime = Date.now();
          const date = response.headers.get("Date");
          if (date) responseTime = Date.parse(date) + 1000;
        },
      });
      if (!mounted.current) return;
      sessionStorage.removeItem(key);
      setPending(null);
      if (command.kind === "schedule" && "undo" in result) {
        const remaining = Math.min(
          10_000,
          Date.parse(result.undo.expiresAt) -
            responseTime -
            (performance.now() - receivedAt),
        );
        setToast(
          remaining > 0
            ? {
                label: command.label,
                id: result.undo.id,
                deadline: performance.now() + remaining,
              }
            : null,
        );
      } else setToast(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status !== 401 && e.status < 500) {
        sessionStorage.removeItem(key);
        setPending(null);
        if (command.kind === "undo") setToast(null);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function schedule(task: Task, value: Schedule) {
    if (pending || inFlight.current || !connected) return;
    setToast(null);
    void run({
      path: `/tasks/${task.id}/schedule`,
      options: {
        method: "POST",
        key: crypto.randomUUID(),
        body: { ...value, expectedRevision: task.revision },
      },
      kind: "schedule",
      label: task.title,
    });
  }
  function undo() {
    if (
      !toast ||
      performance.now() >= toast.deadline ||
      inFlight.current ||
      pending ||
      !connected
    )
      return;
    void run({
      path: `/undo/${toast.id}`,
      options: { method: "POST", key: crypto.randomUUID(), body: {} },
      kind: "undo",
      label: toast.label,
    });
  }
  return {
    schedule,
    undo,
    retry: () => {
      if (pending) void run(pending);
    },
    busy,
    error,
    toast,
    pending,
    blocked: busy || !!pending,
    reportError: (e: unknown) => setError(errorMessage(e)),
    dismiss: () => {
      if (!pending) setError("");
    },
    expire: () => setToast(null),
  };
}
