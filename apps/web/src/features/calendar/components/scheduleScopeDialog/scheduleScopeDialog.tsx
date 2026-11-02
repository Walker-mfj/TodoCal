"use client";
import { bindStyles } from "../../../../shared/utils/classNames";
const cx = bindStyles();

import { Repeat2 } from "lucide-react";
import { Dialog } from "../../../../shared/components/dialog/dialog";
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
  onChoose: (scope: "one" | "following") => Promise<void>;
}) {
  return (
    <Dialog
      title="Reschedule repeating task"
      icon={Repeat2}
      busy={busy}
      onDismiss={onCancel}
      description="Apply this schedule to this occurrence, or this and following occurrences? Finalized history stays unchanged. Other task details stay the same."
      actions={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onChoose("one")}
            className={cx("", true)}
          >
            This occurrence
          </button>
          <button
            type="button"
            className={cx("primary", true)}
            disabled={busy || !allAvailable}
            onClick={() => void onChoose("following")}
          >
            {busy ? "Saving…" : "This and following"}
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
        <p className={cx("error")} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
