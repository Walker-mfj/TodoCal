import type { FocusState, FocusKind } from "../hooks/useFocus";

/** Snapshot and actions required by task-level focus controls. The controller
 * owns receivedAt; mounting another display never creates a new anchor. */
export type FocusView = {
  active: FocusState["active"] | undefined;
  receivedAt: number;
  blocked: boolean;
  start: (kind: FocusKind, taskId?: string, durationMinutes?: number) => void;
  change: (action: "pause" | "resume" | "end") => void;
};
