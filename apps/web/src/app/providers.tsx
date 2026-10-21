"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch, ApiError, type RequestOptions } from "../lib/api";
import type { Session } from "../lib/model";
export type Execute = <T = unknown>(
  path: string,
  options?: RequestOptions,
) => Promise<T>;
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
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 10_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            refetchInterval: () =>
              typeof document !== "undefined" &&
              document.visibilityState === "visible"
                ? 15_000
                : false,
          },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}
function SessionProvider({ children }: { children: ReactNode }) {
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
  const refresh = useCallback(async () => {
    const version = epoch.current;
    try {
      const result = await apiFetch<Session>("/auth/me");
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
      if (e instanceof ApiError && e.status === 401) clear(!!current.current);
      else setConnected(false);
    } finally {
      setLoading(false);
    }
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
    const timer = setInterval(tick, 15_000);
    window.addEventListener("focus", online);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", tick);
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("focus-calendar");
      channel.current.onmessage = online;
    }
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", online);
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
        const out = await apiFetch<T>(path, {
          ...options,
          csrf: auth?.csrfToken,
          owner: options.owner || auth?.user.id,
        });
        if (version !== epoch.current)
          throw new ApiError(401, "Account changed");
        setConnected(navigator.onLine);
        return out;
      } catch (e) {
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
    await apiFetch(register ? "/auth/register" : "/auth/login", {
      method: "POST",
      body: {
        email,
        password,
        ...(register
          ? { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
          : {}),
      },
    });
    await refresh();
    channel.current?.postMessage("session");
  };
  const logout = async () => {
    const owner = current.current?.user.id;
    await execute("/auth/logout", { method: "POST", body: {} });
    if (owner) {
      for (const key of Object.keys(sessionStorage)) {
        if (
          ["draft", "form", "command"].some((kind) =>
            key.startsWith(`focus:${kind}:${owner}:`),
          )
        )
          sessionStorage.removeItem(key);
      }
    }
    clear();
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
      {children}
    </Context.Provider>
  );
}
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing session provider");
  return value;
}
export function useOwnedQuery<T>(name: string, path: string, enabled = true) {
  const { session, read } = useSession();
  return useQuery({
    queryKey: [session?.user.id, name, path],
    queryFn: ({ signal }) => read<T>(path, { signal, owner: session?.user.id }),
    enabled: !!session && enabled,
  });
}
