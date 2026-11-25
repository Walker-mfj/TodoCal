"use client";
import { LoadingIndicator } from "../../../../shared/components/loadingIndicator/loadingIndicator";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { bindStyles } from "../../../../shared/utils/classNames";
import type { Task } from "../../../../shared/api/domainTypes";
const cx = bindStyles();
export function CompletionTimeForm({
  task,
  zone,
  locked,
  saving = false,
  onSave,
}: {
  task: Task;
  zone: string;
  locked: boolean;
  saving?: boolean;
  onSave: (completedAt: string) => void;
}) {
  const [completionError, setCompletionError] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  useEffect(() => {
    setCompletedAt(
      task.completedAt
        ? DateTime.fromISO(task.completedAt)
            .setZone(zone)
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : "",
    );
  }, [task.completedAt, zone]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const value = DateTime.fromISO(completedAt, { zone });
        if (
          !value.isValid ||
          value.toFormat("yyyy-MM-dd'T'HH:mm") !== completedAt
        ) {
          setCompletionError("Enter a valid completion time.");
          return;
        }
        setCompletionError("");
        onSave(value.toUTC().toISO()!);
      }}
    >
      <label className={cx("", true)}>
        Change completed at
        <input
          type="datetime-local"
          required
          value={completedAt}
          disabled={locked}
          onChange={(event) => setCompletedAt(event.target.value)}
          className={cx("", true)}
        />
      </label>
      <small>Time uses {zone}; the scheduled date stays unchanged.</small>
      <button
        disabled={locked}
        className={cx("", true)}
        data-pending-control="true"
        aria-busy={Boolean(saving)}
      >
        <span data-button-content="true">
          {saving && <LoadingIndicator />}Save completion time
        </span>
        <span aria-hidden="true" data-button-reserve="true">
          Save completion time
        </span>
      </button>
      {completionError && <p role="alert">{completionError}</p>}
    </form>
  );
}
