import type { Task } from "../../../shared/api/domainTypes";
export type Draft = {
  title: string;
  description?: string;
  groupId?: string;
  priority?: Task["priority"];
  scheduledDate?: string;
  startTime?: string;
  endTime?: string;
  deadline?: string;
  estimatedPomodoros?: string;
  focusMinutes?: string;
  cadence?: string;
  intervalDays?: number;
  endDate?: string;
};
