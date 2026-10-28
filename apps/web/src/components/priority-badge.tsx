import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { Task } from "../lib/model";

export const priorityLabels = {
  low: "Low",
  medium: "Medium",
  high: "High",
} as const;
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
      className={`priority-badge priority-${priority}${compact ? " priority-compact" : ""}`}
      aria-label={label}
      title={label}
    >
      <Icon size={12} aria-hidden="true" />
      {!compact && (
        <span className="priority-label">{priorityLabels[priority]}</span>
      )}
    </span>
  );
}
