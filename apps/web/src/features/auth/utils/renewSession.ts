import { apiFetch, ApiError } from "../../../shared/api/apiClient";
import type { Session } from "../types/sessionTypes";
let pending: Promise<Session> | null = null;
let localQueue: Promise<unknown> = Promise.resolve();

// Every request that can write authentication cookies uses this same lock.
// Web Locks coordinate tabs; the local queue also supports older browsers.
export function withSessionLock<T>(action: () => Promise<T>): Promise<T> {
  const task = localQueue
    .catch(() => {})
    .then(async () => {
      if (typeof navigator !== "undefined" && navigator.locks)
        return await navigator.locks.request("todocal-auth-refresh", action);
      return action();
    });
  localQueue = task.catch(() => {});
  return task;
}

// Caller must hold withSessionLock; logout uses this without nesting locks.
export async function readOrRenewSession(): Promise<Session> {
  try {
    return await apiFetch<Session>("/auth/me");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  await apiFetch("/auth/refresh", { method: "POST", body: {} });
  return apiFetch<Session>("/auth/me");
}

// Only called after an authentication failure, never on a background interval.
export function renewSession(): Promise<Session> {
  if (pending) return pending;
  const task = withSessionLock(readOrRenewSession).finally(() => {
    pending = null;
  });
  pending = task;
  return task;
}
