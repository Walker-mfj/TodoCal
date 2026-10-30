import { dateLabel } from "../../../shared/utils/dateUtils";
export function recurrenceSummary(cadence: string, interval = 2, end = "") {
  const text =
    cadence === "daily"
      ? "Every day"
      : cadence === "weekly"
        ? "Every week"
        : cadence === "interval"
          ? `Every ${interval} days`
          : "Does not repeat";
  return (
    text +
    (cadence && cadence !== "none" && end
      ? ` · through ${dateLabel(end)} (inclusive)`
      : "")
  );
}
