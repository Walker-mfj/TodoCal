"use client";
import { Repeat2 } from "lucide-react";
import { Dialog } from "../../components/dialog";
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
  return (
    <Dialog
      title="Reschedule repeating task"
      icon={Repeat2}
      busy={busy}
      onDismiss={onCancel}
      description="Apply this schedule to this occurrence, or all occurrences from today onward? Finalized history stays unchanged. Other task details stay the same."
      actions={
        <>
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
        </>
      }
    >
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
    </Dialog>
  );
}
