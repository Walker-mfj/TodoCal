import { DateTime } from "luxon";

/** FullCalendar displays account-local wall times through its UTC time grid. */
export function initialCalendarScrollTime(
  timezone: string,
  now = DateTime.now(),
): string {
  return now.setZone(timezone).toFormat("HH:mm:ss");
}
