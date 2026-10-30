import type { CSSProperties } from "react";
import { progressLevel } from "../../utils/progress";
import { bindStyles } from "../../utils/classNames";
import styles from "./progressRing.module.css";
const cx = bindStyles(styles);
export function Ring({
  value,
  small = false,
  ratio,
}: {
  value: number | null;
  small?: boolean;
  ratio?: number | null;
}) {
  return (
    <span
      className={cx(
        `progress-ring ${progressLevel(ratio === undefined ? value : ratio)} ${small ? "small" : ""}`,
      )}
      style={{ "--progress": `${(value || 0) * 3.6}deg` } as CSSProperties}
    >
      <span>{value === null ? "—" : `${value}%`}</span>
      {value === 100 && (
        <i className={cx("ring-check")} aria-label="Plan complete">
          ✓
        </i>
      )}
    </span>
  );
}
