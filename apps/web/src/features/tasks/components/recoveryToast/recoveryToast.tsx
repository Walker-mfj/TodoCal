"use client";
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
        {item.kind === "task" ? "Task deleted" : "Repeating stopped"} ·{" "}
      </span>
      <button
        disabled={!connected || command.busy}
        onClick={restore}
        className={cx("", true)}
      >
        {command.busy
          ? "Restoring…"
          : command.uncertain
            ? "Retry restore"
            : "Undo"}
      </button>
      {command.error && <p>{command.error}</p>}
    </ToastNotice>
  );
}
