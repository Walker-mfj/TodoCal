import { DateTime } from "luxon";
export function today(zone: string) {
  return DateTime.now().setZone(zone).toISODate()!;
}

export function dateLabel(date: string, format = "MMM d, yyyy") {
  return DateTime.fromISO(date, { zone: "UTC" }).toFormat(format);
}
