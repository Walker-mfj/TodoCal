import type { components } from "./apiTypes.generated";
export type Task = components["schemas"]["Task"];

export type Group = components["schemas"]["Group"];

export type Settings = components["schemas"]["Settings"];

export type Day = components["schemas"]["DayReport"];

export type CalendarRange = components["schemas"]["CalendarRange"];

export type RecurrenceRule = {
  cadence: "daily" | "weekly" | "interval";
  intervalDays: number;
  endDate: string | null;
};
