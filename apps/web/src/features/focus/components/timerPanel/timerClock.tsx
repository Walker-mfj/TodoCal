import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./timerClock.module.css";
import { timerLabel } from "../../utils/clock";
import type { FocusState } from "../../hooks/useFocus";
const cx = bindStyles(styles);
export function TimerClock({
  seconds,
  ratio,
  active,
  connected,
}: {
  seconds: number;
  ratio: number;
  active: FocusState["active"] | undefined;
  connected: boolean;
}) {
  return (
    <div className={cx("focus-clock")}>
      <svg viewBox="0 0 360 360" aria-hidden="true">
        <circle cx="180" cy="180" r="170" />
        <circle
          className={cx("focus-arc")}
          cx="180"
          cy="180"
          r="170"
          style={{
            strokeDashoffset: 1068 * (1 - Math.max(0, Math.min(1, ratio))),
          }}
        />
      </svg>
      <span role="timer" aria-label="Time remaining">
        {timerLabel(seconds)}
      </span>
      <small>
        {active
          ? active.status === "paused"
            ? "Paused"
            : !connected
              ? "Offline · estimated"
              : seconds === 0
                ? "Confirming completion…"
                : "Time to focus"
          : "Ready when you are"}
      </small>
    </div>
  );
}
