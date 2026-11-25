"use client";
import { usePendingAction } from "../../../../shared/hooks/usePendingAction";

import { LoadingIndicator } from "../../../../shared/components/loadingIndicator/loadingIndicator";

import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./timerBar.module.css";
const cx = bindStyles(styles);

import { Timer, Pause, Play } from "lucide-react";
import type { FocusController } from "../../hooks/useFocus";
import { useRemaining } from "../../hooks/useRemaining";
import { kindLabel, timerLabel } from "../../utils/clock";
export function TimerBar({
  focus,
  onOpen,
}: {
  focus: FocusController;
  onOpen: () => void;
}) {
  const actions = usePendingAction();
  const a = focus.active;
  const remaining = useRemaining(a, focus.receivedAt);
  if (!a) return null;
  return (
    <section className={cx("timer-bar")} aria-label="Active timer">
      <Timer size={18} />
      <button className={cx("text-button timer-title", true)} onClick={onOpen}>
        {a.taskTitle || kindLabel[a.kind]}
      </button>
      <span
        className={cx("timer-digits")}
        role="timer"
        aria-label="Time remaining"
      >
        {timerLabel(remaining)}
      </span>
      <span className={cx("timer-state")}>
        {a.status === "paused" ? (
          "Paused"
        ) : !focus.connected ? (
          "Offline · estimated"
        ) : remaining === 0 ? (
          <>
            {focus.query.isFetching && <LoadingIndicator />}
            Confirming completion…
          </>
        ) : (
          kindLabel[a.kind]
        )}
      </span>
      <button
        disabled={focus.blocked || remaining === 0}
        onClick={() =>
          void actions.run("primary", () =>
            focus.change(a.status === "paused" ? "resume" : "pause"),
          )
        }
        className={cx("", true)}
        data-pending-control="true"
        aria-busy={Boolean(actions.isPending("primary") && focus.connected)}
      >
        <span data-button-content="true">
          {actions.isPending("primary") && focus.connected && (
            <LoadingIndicator />
          )}
          {a.status === "paused" ? <Play size={14} /> : <Pause size={14} />}{" "}
          {a.status === "paused" ? "Resume" : "Pause"}
        </span>
        <span aria-hidden="true" data-button-reserve="true">
          Resume
        </span>
        <span aria-hidden="true" data-button-reserve="true">
          Pause
        </span>
      </button>
      <button
        disabled={focus.blocked}
        onClick={() => void actions.run("end", () => focus.change("end"))}
        className={cx("", true)}
        data-pending-control="true"
        aria-busy={Boolean(actions.isPending("end") && focus.connected)}
      >
        <span data-button-content="true">
          {actions.isPending("end") && focus.connected && <LoadingIndicator />}
          End session
        </span>
        <span aria-hidden="true" data-button-reserve="true">
          End session
        </span>
      </button>
    </section>
  );
}
