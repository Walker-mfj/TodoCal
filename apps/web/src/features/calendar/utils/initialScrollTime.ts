import { DateTime } from "luxon";

const INITIAL_SCROLL_LOOKBACK_HOURS = 3;

/** Keep the now indicator visible with preceding context. */
export function initialCalendarScrollTime(
  timezone: string,
  now: DateTime = DateTime.now(),
): string {
  // FullCalendar's UTC time grid displays account-local wall-clock labels.
  const accountNow = now.setZone(timezone);
  if (accountNow.hour < INITIAL_SCROLL_LOOKBACK_HOURS) return "00:00:00";
  return `${String(accountNow.hour - INITIAL_SCROLL_LOOKBACK_HOURS).padStart(2, "0")}:00:00`;
}
