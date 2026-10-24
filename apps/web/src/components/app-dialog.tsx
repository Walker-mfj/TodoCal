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
import { AlertCircle } from "lucide-react";
type Options = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};
type Confirm = (message: string, options?: Options) => Promise<boolean>;
const Context = createContext<Confirm | null>(null);
export function useConfirm(): Confirm {
  const confirm = useContext(Context);
  return useCallback(
    (message, options) => {
      if (!confirm) throw new Error("Confirmation requires AppDialogProvider");
      return confirm(message, options);
    },
    [confirm],
  );
}
export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<
    ({ message: string } & Options) | null
  >(null);
  const pending = useRef<((answer: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const confirm = useCallback<Confirm>((message, options) => {
    // Only one decision can be active; never replace an unanswered request.
    if (pending.current) return Promise.resolve(false);
    trigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return new Promise((resolve) => {
      pending.current = resolve;
      setRequest({ message, ...options });
    });
  }, []);
  const finish = useCallback((answer: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    dialog.current?.close();
    setRequest(null);
    if (trigger.current?.isConnected) trigger.current.focus();
    resolve?.(answer);
  }, []);
  useEffect(() => {
    if (request) {
      dialog.current?.showModal();
      cancel.current?.focus();
    }
  }, [request]);
  useEffect(
    () => () => {
      pending.current?.(false);
      pending.current = null;
    },
    [],
  );
  return (
    <Context.Provider value={confirm}>
      {children}
      {request && (
        <dialog
          ref={dialog}
          className="app-dialog"
          role="alertdialog"
          aria-labelledby="app-dialog-title"
          aria-describedby="app-dialog-description"
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const buttons =
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              );
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
          onCancel={(event) => {
            event.preventDefault();
            finish(false);
          }}
        >
          <div
            className={`app-dialog-icon ${request.destructive ? "destructive" : ""}`}
          >
            <AlertCircle size={24} aria-hidden="true" />
          </div>
          <h2 id="app-dialog-title">{request.title || "Please confirm"}</h2>
          <p id="app-dialog-description">{request.message}</p>
          <div className="app-dialog-actions">
            <button ref={cancel} type="button" onClick={() => finish(false)}>
              {request.cancelLabel || "Cancel"}
            </button>
            <button
              type="button"
              className={request.destructive ? "dialog-danger" : "primary"}
              onClick={() => finish(true)}
            >
              {request.confirmLabel || "Continue"}
            </button>
          </div>
        </dialog>
      )}
    </Context.Provider>
  );
}
