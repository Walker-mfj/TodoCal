"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  X,
} from "lucide-react";
type Tone = "success" | "warning" | "error" | "info";
type Entry = {
  id: string;
  tone: Tone;
  children: ReactNode;
  duration: number;
  close: () => void;
};
const Context = createContext<{
  put: (entry: Entry) => void;
  remove: (id: string) => void;
} | null>(null);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const put = useCallback(
    (entry: Entry) =>
      setEntries((old) =>
        old.some((item) => item.id === entry.id)
          ? old.map((item) => (item.id === entry.id ? entry : item))
          : [...old, entry],
      ),
    [],
  );
  const remove = useCallback(
    (id: string) =>
      setEntries((old) =>
        old.some((item) => item.id === id)
          ? old.filter((item) => item.id !== id)
          : old,
      ),
    [],
  );
  const value = useMemo(() => ({ put, remove }), [put, remove]);
  return (
    <Context.Provider value={value}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <section className="toast-stack" aria-label="Notifications">
            {entries.slice(0, 3).map((entry) => (
              <ToastCard key={entry.id} entry={entry} />
            ))}
          </section>,
          document.body,
        )}
    </Context.Provider>
  );
}
function ToastCard({ entry }: { entry: Entry }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const remaining = useRef(entry.duration);
  const [milliseconds, setMilliseconds] = useState(entry.duration);
  const close = useRef(entry.close);
  close.current = entry.close;
  useEffect(() => {
    remaining.current = entry.duration;
    setMilliseconds(entry.duration);
  }, [entry.duration]);
  useEffect(() => {
    if (!entry.duration || paused) return;
    const deadline = Date.now() + remaining.current;
    const update = () => setMilliseconds(Math.max(0, deadline - Date.now()));
    const tick = setInterval(update, 50);
    const timer = setTimeout(() => close.current(), remaining.current);
    return () => {
      remaining.current = Math.max(0, deadline - Date.now());
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, [entry.duration, paused]);
  const Icon = {
    success: CheckCircle2,
    warning: AlertTriangle,
    error: AlertCircle,
    info: Info,
  }[entry.tone];
  return (
    <div
      className={`app-toast toast-${entry.tone}`}
      role={
        entry.tone === "error" || entry.tone === "warning" ? "alert" : "status"
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      {entry.duration > 0 && (
        <div className="toast-countdown" aria-hidden="true">
          <span
            style={{
              transform: `scaleX(${Math.max(0, Math.min(1, milliseconds / entry.duration))})`,
            }}
          />
        </div>
      )}
      <Icon className="toast-icon" size={20} aria-hidden="true" />
      <div className="toast-content">{entry.children}</div>
      <button
        className="toast-close"
        aria-label="Dismiss notification"
        onClick={entry.close}
      >
        <X size={16} />
      </button>
    </div>
  );
}
/** Declarative adapter: updates actions without duplicating or restarting a toast. */
export function ToastNotice({
  children,
  tone = "info",
  duration,
  resetKey = "",
  onDismiss,
}: {
  children: ReactNode;
  tone?: Tone;
  duration?: number;
  resetKey?: string;
  onDismiss?: () => void;
}) {
  const context = useContext(Context);
  if (!context) throw Error("ToastNotice requires ToastProvider");
  const id = useId();
  const key = `${id}:${resetKey}`;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const { put, remove } = context;
  useEffect(() => {
    if (dismissed === key) return;
    put({
      id: key,
      children,
      tone,
      duration:
        duration ?? (tone === "success" ? 3000 : tone === "error" ? 0 : 6000),
      close: () => {
        setDismissed(key);
        remove(key);
        onDismiss?.();
      },
    });
  }, [key, children, tone, duration, dismissed, put, remove, onDismiss]);
  useEffect(() => () => remove(key), [key, remove]);
  return null;
}
