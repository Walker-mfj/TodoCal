"use client";
import { bindStyles } from "../../utils/classNames";
const cx = bindStyles();

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dialog } from "../dialog/dialog";
import { AlertCircle, Trash2 } from "lucide-react";
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
  const confirm = useCallback<Confirm>((message, options) => {
    // Only one decision can be active; never replace an unanswered request.
    if (pending.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      pending.current = resolve;
      setRequest({ message, ...options });
    });
  }, []);
  const finish = useCallback((answer: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(answer);
  }, []);
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
        <Dialog
          role="alertdialog"
          title={request.title || "Please confirm"}
          icon={request.destructive ? Trash2 : AlertCircle}
          destructive={request.destructive}
          description={request.message}
          cancelLabel={request.cancelLabel}
          onDismiss={() => finish(false)}
          actions={
            <button
              type="button"
              className={cx(
                request.destructive ? "dialog-danger" : "primary",
                true,
              )}
              onClick={() => finish(true)}
            >
              {request.confirmLabel || "Continue"}
            </button>
          }
        />
      )}
    </Context.Provider>
  );
}
