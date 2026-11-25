"use client";
import { LoadingIndicator } from "../../../../shared/components/loadingIndicator/loadingIndicator";

import { bindStyles } from "../../../../shared/utils/classNames";
const cx = bindStyles();

import type { Execute } from "../../../../shared/api/apiClient";
import { ToastNotice } from "../../../../shared/components/toast/toast";
import { useCommand } from "../../../../shared/hooks/useCommand";

export type RecoveryItem = {
  kind: "task" | "series";
  id: string;
  revision: number;
};
export function RecoveryToast({
  item,
  execute,
  connected,
  onRestored,
  onDismiss,
}: {
  item: RecoveryItem;
  execute: Execute;
  connected: boolean;
  onRestored: () => void;
  onDismiss: () => void;
}) {
  const command = useCommand(execute);
  const restore = () =>
    void command.run(
      `/${item.kind === "task" ? "tasks" : "series"}/${item.id}/restore`,
      "POST",
      { expectedRevision: item.revision },
      onRestored,
    );
  return (
    <ToastNotice
      tone={command.error ? "error" : "success"}
      duration={command.busy || command.error ? 0 : 10000}
      onDismiss={onDismiss}
    >
      <span>
        {item.kind === "task" ? "Task deleted" : "Repeating tasks deleted"}{" "}
        ·{" "}
      </span>
      <button
        disabled={!connected || command.busy}
        onClick={restore}
        className={cx("", true)}
        data-pending-control="true"
        aria-busy={Boolean(command.busy)}
      >
        <span data-button-content="true">
          {command.busy ? (
            <>
              <LoadingIndicator />
              Restoring…
            </>
          ) : command.uncertain ? (
            "Retry restore"
          ) : (
            "Undo"
          )}
        </span>
        <span aria-hidden="true" data-button-reserve="true">
          Restoring…
        </span>
        <span aria-hidden="true" data-button-reserve="true">
          Retry restore
        </span>
        <span aria-hidden="true" data-button-reserve="true">
          Undo
        </span>
      </button>
      {command.error && <p>{command.error}</p>}
    </ToastNotice>
  );
}
