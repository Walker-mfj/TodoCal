"use client";
import { Skeleton } from "../../../shared/components/skeleton/skeleton";
import { bindStyles } from "../../../shared/utils/classNames";
import styles from "./progressPanel.module.css";
const cx = bindStyles(styles);
import { DateTime } from "luxon";
import {
  AnalyticsSummary,
  type PeriodReport,
} from "../../../features/analytics";
import { DayStrip, ProgressLegend } from "../../../features/calendar";
import { dateLabel } from "../../../shared/utils/dateUtils";
import { errorMessage } from "../../../shared/api/apiClient";
export function ProgressPanel({
  report,
  reportFrom,
  reportTo,
  period,
  setPeriod,
  periodDate,
  setPeriodDate,
  selectedReportDate,
  date,
  onDay,
}: {
  report: { data?: PeriodReport; error: unknown; isPending: boolean };
  reportFrom: string;
  reportTo: string;
  period: "week" | "month";
  setPeriod: (value: "week" | "month") => void;
  periodDate: string;
  setPeriodDate: (value: string) => void;
  selectedReportDate?: string;
  date: string;
  onDay: (date: string) => void;
}) {
  const periodStart = DateTime.fromISO(periodDate).startOf(period);
  return (
    <section className={cx("report-card")}>
      <div className={cx("list-heading")}>
        <div>
          <h2>
            {dateLabel(reportFrom, period === "week" ? "MMM d" : "MMMM yyyy")}
            {period === "week"
              ? ` – ${dateLabel(DateTime.fromISO(reportTo).minus({ days: 1 }).toISODate()!, "MMM d, yyyy")}`
              : ""}
          </h2>
          <p className={cx("muted")}>
            All tasks included. Select a day to see its details.
          </p>
        </div>
        <div className={cx("report-controls")}>
          <input
            type="date"
            aria-label="Report date"
            value={periodDate}
            onChange={(e) => {
              if (e.target.value) setPeriodDate(e.target.value);
            }}
            className={cx("", true)}
          />
          <button
            aria-label="Previous period"
            onClick={() =>
              setPeriodDate(
                periodStart
                  .minus(period === "week" ? { weeks: 1 } : { months: 1 })
                  .toISODate()!,
              )
            }
            className={cx("", true)}
          >
            ←
          </button>
          <button onClick={() => setPeriodDate(date)} className={cx("", true)}>
            Today
          </button>
          <button
            aria-label="Next period"
            onClick={() =>
              setPeriodDate(
                periodStart
                  .plus(period === "week" ? { weeks: 1 } : { months: 1 })
                  .toISODate()!,
              )
            }
            className={cx("", true)}
          >
            →
          </button>
          <select
            aria-label="Progress period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as "week" | "month")}
            className={cx("", true)}
          >
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </div>
      </div>
      {report.data && (
        <AnalyticsSummary report={report.data} onDay={(date) => onDay(date)} />
      )}
      {report.error ? (
        <p className={cx("error")}>{errorMessage(report.error)}</p>
      ) : report.isPending ? (
        <div>
          <span role="status" aria-label="Loading progress…" aria-live="polite">
            <span
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                overflow: "hidden",
                clipPath: "inset(50%)",
              }}
              className="sr-only"
            >
              Loading progress…
            </span>
            <Skeleton width={80} height={80} variant="circle" />
            <Skeleton width="70%" height={24} />
          </span>
        </div>
      ) : (
        <div className={cx(`report-days ${period}`)}>
          <DayStrip
            selectedDate={selectedReportDate}
            month={period === "month"}
            days={report.data?.days || []}
            onOpen={(date) => onDay(date)}
          />
        </div>
      )}
      <ProgressLegend />
    </section>
  );
}
