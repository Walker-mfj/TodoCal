"use client";
import { LoadingIndicator } from "../../../../shared/components/loadingIndicator/loadingIndicator";

import { bindStyles } from "../../../../shared/utils/classNames";
const cx = bindStyles();

import { useState } from "react";
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
  const [selected, setSelected] = useState<"one" | "following" | null>(null);
  async function choose(scope: "one" | "following") {
    setSelected(scope);
    try {
      await onChoose(scope);
    } finally {
      setSelected(null);
    }
  }
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
            onClick={() => void choose("one")}
            className={cx("", true)}
            data-pending-control="true"
            aria-busy={Boolean(busy && selected === "one")}
          >
            <span data-button-content="true">
              {busy && selected === "one" ? (
                <>
                  <LoadingIndicator />
                  Saving…
                </>
              ) : (
                "This occurrence"
              )}
            </span>
            <span aria-hidden="true" data-button-reserve="true">
              Saving…
            </span>
            <span aria-hidden="true" data-button-reserve="true">
              This occurrence
            </span>
          </button>
          <button
            type="button"
            className={cx("primary", true)}
            disabled={busy || !allAvailable}
            onClick={() => void choose("following")}
            data-pending-control="true"
            aria-busy={Boolean(busy && selected === "following")}
          >
            <span data-button-content="true">
              {busy && selected === "following" ? (
                <>
                  <LoadingIndicator />
                  Saving…
                </>
              ) : (
                "This and following"
              )}
            </span>
            <span aria-hidden="true" data-button-reserve="true">
              Saving…
            </span>
            <span aria-hidden="true" data-button-reserve="true">
              This and following
            </span>
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
