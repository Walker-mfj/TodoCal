import { DateTime } from "luxon";

/** Keep the now indicator visible with two hours of preceding context. */
export function initialCalendarScrollTime(
  timezone: string,
  now = DateTime.now(),
): string {
  // FullCalendar's UTC time grid displays account-local wall-clock labels.
  const accountNow = now.setZone(timezone);
  if (accountNow.hour < 2) return "00:00:00";
  return `${String(accountNow.hour - 2).padStart(2, "0")}:${accountNow.toFormat("mm:ss")}`;
}
