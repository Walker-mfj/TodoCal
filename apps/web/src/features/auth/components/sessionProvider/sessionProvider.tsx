"use client";
import { bindStyles } from "../../../../shared/utils/classNames";
const cx = bindStyles();

import { sessionStore } from "../../../../shared/utils/sessionStorage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CancelledError, useQueryClient } from "@tanstack/react-query";
import {
  apiFetch,
  ApiError,
  type RequestOptions,
} from "../../../../shared/api/apiClient";
import {
  renewSession,
  readOrRenewSession,
  withSessionLock,
} from "../../utils/renewSession";
import type { Session } from "../../types/sessionTypes";
type State = {
  session: Session | null;
  loading: boolean;
  connected: boolean;
  expired: boolean;
  authenticate: (
    email: string,
    password: string,
    register: boolean,
  ) => Promise<void>;
  logout: () => Promise<void>;
  read: Execute;
  execute: Execute;
  refresh: () => Promise<void>;
};
const Context = createContext<State | null>(null);
import type { Execute } from "../../../../shared/api/apiClient";
export function SessionProvider({ children }: { children: ReactNode }) {
  const storageUnavailable = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.isUnavailable,
    () => false,
  );
  const client = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const current = useRef<Session | null>(null);
  const [loading, setLoading] = useState(true),
    [connected, setConnected] = useState(true),
    [expired, setExpired] = useState(false);
  const epoch = useRef(0),
    channel = useRef<BroadcastChannel | null>(null);
  const clear = useCallback(
    (wasExpired = false) => {
      epoch.current++;
      current.current = null;
      setSession(null);
      setExpired(wasExpired);
      void client.cancelQueries();
      client.clear();
      document.documentElement.dataset.mode = "light";
    },
    [client],
  );
  const refreshing = useRef<{ version: number; promise: Promise<void> } | null>(
    null,
  );
  const refresh = useCallback(() => {
    const version = epoch.current;
    if (refreshing.current?.version === version)
      return refreshing.current.promise;
    const promise = (async () => {
      try {
        const result = await apiFetch<Session>("/auth/me").catch((error) => {
          if (error instanceof ApiError && error.status === 401)
            return renewSession();
          throw error;
        });
        if (version !== epoch.current) return;
        if (current.current && current.current.user.id !== result.user.id) {
          clear();
        }
        current.current = result;
        setSession(result);
        setConnected(navigator.onLine);
        setExpired(false);
        document.documentElement.dataset.mode = result.settings.appearance;
      } catch (e) {
        if (version !== epoch.current) return;
        if (e instanceof ApiError && e.status === 401) {
          clear(!!current.current);
          setLoading(false);
        } else setConnected(false);
      } finally {
        if (version === epoch.current) setLoading(false);
        if (refreshing.current?.version === version) refreshing.current = null;
      }
    })();
    refreshing.current = { version, promise };
    return promise;
  }, [clear]);
  useEffect(() => {
    void refresh();
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const offline = () => setConnected(false);
    const online = async () => {
      await refresh();
      await client.invalidateQueries();
    };
    window.addEventListener("focus", tick);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", tick);
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("focus-calendar");
      channel.current.onmessage = online;
    }
    return () => {
      window.removeEventListener("focus", tick);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", tick);
      channel.current?.close();
      channel.current = null;
    };
  }, [refresh, client]);
  const request: Execute = useCallback(
    async <T,>(path: string, options: RequestOptions = {}) => {
      const version = epoch.current;
      const auth = current.current;
      if (options.owner && options.owner !== auth?.user.id)
        throw new DOMException("Account changed", "AbortError");
      try {
        const send = (csrf: string | undefined) =>
          apiFetch<T>(path, {
            ...options,
            csrf,
            owner: options.owner || auth?.user.id,
          });
        let out: T;
        try {
          out = await send(auth?.csrfToken);
        } catch (error) {
          if (options.signal?.aborted)
            throw new CancelledError({ silent: true });
          // These errors are emitted before mutation; never replay ambiguous
          // network/server failures, and never replay into a different account.
          if (
            !(error instanceof ApiError) ||
            error.code === "account_changed" ||
            !(
              error.status === 401 ||
              (error.status === 403 && error.code === "csrf")
            )
          )
            throw error;
          const renewed = await renewSession();
          if (
            version !== epoch.current ||
            (auth && renewed.user.id !== auth.user.id)
          )
            throw new ApiError(401, "Account changed", "account_changed");
          current.current = renewed;
          setSession(renewed);
          out = await send(renewed.csrfToken);
        }
        if (version !== epoch.current)
          throw new ApiError(401, "Account changed");
        setConnected(navigator.onLine);
        return out;
      } catch (e) {
        // Query cancellation is expected when a view/period changes. Normalize
        // the browser's abort into React Query's silent cancellation rather than
        // propagating a native DOMException through the authentication chain.
        if (options.signal?.aborted) throw new CancelledError({ silent: true });
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        if (version === epoch.current) {
          if (e instanceof ApiError && e.status === 401) clear(true);
          else if (!(e instanceof ApiError) || e.status >= 500)
            setConnected(false);
        }
        throw e;
      }
    },
    [clear],
  );
  const execute: Execute = useCallback(
    async <T,>(path: string, options: RequestOptions = {}) => {
      if (!navigator.onLine || !connected) throw new TypeError("Offline");
      try {
        const result = await request<T>(path, options);
        await client.invalidateQueries();
        channel.current?.postMessage("changed");
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          await Promise.all([client.invalidateQueries(), refresh()]);
        }
        throw error;
      }
    },
    [request, connected, client, refresh],
  );
  const authenticate = async (
    email: string,
    password: string,
    register: boolean,
  ) => {
    clear();
    await withSessionLock(() =>
      apiFetch(register ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: {
          email,
          password,
          ...(register
            ? { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
            : {}),
        },
      }),
    );
    await refresh();
    channel.current?.postMessage("session");
  };
  const logout = async () => {
    const owner = current.current?.user.id;
    await withSessionLock(async () => {
      const latest = await readOrRenewSession();
      if (!owner || latest.user.id !== owner)
        throw new ApiError(401, "Account changed", "account_changed");
      await apiFetch("/auth/logout", {
        method: "POST",
        body: {},
        owner,
        csrf: latest.csrfToken,
      });
      if (owner) sessionStore.clearOwner(owner);
      clear();
    });
    channel.current?.postMessage("session");
  };
  return (
    <Context.Provider
      value={{
        session,
        loading,
        connected,
        expired,
        authenticate,
        logout,
        read: request,
        execute,
        refresh,
      }}
    >
      {storageUnavailable && (
        <p className={cx("notice")} role="status">
          Browser storage is unavailable or full. Drafts and unconfirmed changes
          are kept only in this open page and may be lost on reload. Confirm
          pending changes before refreshing. Browser data may also remain after
          sign out if the browser blocks its removal.
        </p>
      )}
      {children}
    </Context.Provider>
  );
}
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing session provider");
  return value;
}
