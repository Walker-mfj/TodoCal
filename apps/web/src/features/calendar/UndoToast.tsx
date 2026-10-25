"use client";
import { ToastNotice } from "../../components/toast";
import { useEffect, useState } from "react";
export function UndoToast({
  label,
  deadline,
  onUndo,
  onExpire,
  disabled,
}: {
  label: string;
  deadline: number;
  onUndo: () => void;
  onExpire: () => void;
  disabled: boolean;
}) {
  const [seconds, setSeconds] = useState(10);
  useEffect(() => {
    const update = () => {
      const left = Math.max(
        0,
        Math.ceil((deadline - performance.now()) / 1000),
      );
      setSeconds(left);
      if (!left) onExpire();
    };
    update();
    const timer = setInterval(update, 200);
    return () => clearInterval(timer);
  }, [deadline, onExpire]);
  return (
    <ToastNotice
      tone="success"
      duration={0}
      resetKey={String(deadline)}
      onDismiss={onExpire}
    >
      <div className="toast-message">Schedule saved · {label}</div>
      <div className="toast-actions">
        <button onClick={onUndo} disabled={disabled || seconds === 0}>
          Undo
        </button>
        <small>{seconds}s</small>
      </div>
    </ToastNotice>
  );
}
