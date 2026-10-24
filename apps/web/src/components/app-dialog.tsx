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
import { AlertCircle, X, Trash2 } from "lucide-react";
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
  const outsidePointer = useRef(false);
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
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            outsidePointer.current =
              event.target === event.currentTarget &&
              (event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom);
          }}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const outside =
              event.target === event.currentTarget &&
              (event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom);
            if (outsidePointer.current && outside) finish(false);
            outsidePointer.current = false;
          }}
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
          <button
            type="button"
            className="app-dialog-close icon-button"
            aria-label="Close dialog"
            onClick={() => finish(false)}
          >
            <X size={20} aria-hidden="true" />
          </button>
          <div className="app-dialog-heading">
            <div
              className={`app-dialog-icon ${request.destructive ? "destructive" : ""}`}
            >
              {request.destructive ? (
                <Trash2 size={22} aria-hidden="true" />
              ) : (
                <AlertCircle size={22} aria-hidden="true" />
              )}
            </div>
            <div>
              <span className="app-dialog-eyebrow">
                {request.destructive
                  ? "Review this action"
                  : "Before you continue"}
              </span>
              <h2 id="app-dialog-title">{request.title || "Please confirm"}</h2>
            </div>
          </div>
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
