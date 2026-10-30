"use client";
import { sessionStore } from "../utils/sessionStorage";
import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage, type RequestOptions } from "../api/apiClient";
import type { Execute } from "../api/apiClient";
type Command = {
  path: string;
  options: RequestOptions;
  onSuccess?: () => void;
};
// Persist uncertain commands separately from form values; retries reuse exact bytes/key.
export function useCommand(execute: Execute, storageKey?: string) {
  const pending = useRef<Command | null>(null),
    mounted = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [conflict, setConflict] = useState(false);
  useEffect(() => {
    mounted.current = true;
    if (storageKey) {
      try {
        const saved = sessionStore.getItem(storageKey);
        if (saved) {
          pending.current = JSON.parse(saved);
          setUncertain(true);
        }
      } catch {}
    }
    return () => {
      mounted.current = false;
    };
  }, [storageKey]);
  const clearPending = () => {
    pending.current = null;
    if (storageKey) sessionStore.removeItem(storageKey);
  };
  async function run(
    path: string,
    method: string,
    body: unknown,
    onSuccess?: () => void,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    setConflict(false);
    const command = pending.current || {
      path,
      options: { method, body, key: crypto.randomUUID() },
      onSuccess,
    };
    pending.current = command;
    if (storageKey)
      sessionStore.setItem(
        storageKey,
        JSON.stringify({ path: command.path, options: command.options }),
      );
    try {
      await execute(command.path, command.options);
      if (!mounted.current) return;
      clearPending();
      setUncertain(false);
      (command.onSuccess || onSuccess)?.();
    } catch (e) {
      if (!mounted.current) return;
      setError(errorMessage(e));
      const ambiguous =
        !(e instanceof ApiError) || e.status >= 500 || e.status === 401;
      setUncertain(ambiguous);
      setConflict(e instanceof ApiError && e.status === 409);
      if (!ambiguous) clearPending();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function dismissError() {
    setError("");
    setConflict(false);
  }
  return { run, busy, error, uncertain, conflict, dismissError };
}
