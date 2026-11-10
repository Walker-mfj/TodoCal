import { bindStyles } from "../../utils/classNames";
import styles from "./priorityBadge.module.css";
const cx = bindStyles(styles);
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { Task } from "../../api/domainTypes";

import { priorityLabels } from "../../constants/priorityLabels";
const icons = { low: ArrowDown, medium: Minus, high: ArrowUp };

export function PriorityBadge({
  priority,
  compact = false,
}: {
  priority: Task["priority"];
  compact?: boolean;
}) {
  const Icon = icons[priority];
  const label = `${priorityLabels[priority]} priority`;
  return (
    <span
      className={cx(
        `priority-badge priority-${priority}${compact ? " priority-compact" : ""}`,
      )}
      aria-label={label}
      title={label}
    >
      <Icon size={12} aria-hidden="true" />
      {!compact && (
        <span className={cx("priority-label")}>{priorityLabels[priority]}</span>
      )}
    </span>
  );
}
