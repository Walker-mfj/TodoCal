"use client";
import { useEffect, useRef } from "react";
export function ScheduleScopeDialog({
  busy,
  error,
  allAvailable,
  onCancel,
  onChoose,
}: {
  busy: boolean;
  error: string;
  allAvailable: boolean;
  onCancel: () => void;
  onChoose: (scope: "one" | "all") => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="app-dialog"
      aria-labelledby="schedule-scope-title"
      aria-describedby="schedule-scope-description"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="app-dialog-heading">
        <h2 id="schedule-scope-title">Reschedule repeating task</h2>
      </div>
      <p id="schedule-scope-description">
        Apply this schedule to this occurrence, or all occurrences from today
        onward? Finalized history stays unchanged. Other task details stay the
        same.
      </p>
      {!allAvailable && (
        <p>
          To change the date of the whole series, choose an occurrence that
          already has a scheduled date. Removing a date applies to this
          occurrence only.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="app-dialog-actions">
        <button type="button" autoFocus disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onChoose("one")}
        >
          This occurrence
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !allAvailable}
          onClick={() => void onChoose("all")}
        >
          {busy ? "Saving…" : "All occurrences"}
        </button>
      </div>
    </dialog>
  );
}
