import type { Task } from "../../../shared/api/domainTypes";

/** Calendar wall-clock schedule inputs, independent of the task editor. */
export type CalendarSlot = {
  scheduledDate: string;
  scheduledEndDate?: string;
  startTime: string;
  endTime: string;
};
export type CalendarDraft = {
  draft: Partial<CalendarSlot> & { title: string; priority?: Task["priority"] };
  taskId?: string;
};
