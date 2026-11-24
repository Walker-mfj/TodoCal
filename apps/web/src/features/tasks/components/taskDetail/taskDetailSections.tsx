import { LoadingRegion } from "../../../../shared/components/loadingRegion/loadingRegion";
import { Skeleton } from "../../../../shared/components/skeleton/skeleton";
import { DateTime } from "luxon";
import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./taskDetailSections.module.css";
import { recurrenceSummary } from "../../utils/recurrenceSummary";
import { dateLabel } from "../../../../shared/utils/dateUtils";
import type { components } from "../../../../shared/api/apiTypes.generated";
const cx = bindStyles(styles);
export type FocusHistory = {
  actualFocusSeconds: number;
  sessions: components["schemas"]["FocusSession"][];
};
type QueryView<T> = { data?: T; isPending: boolean; error: unknown };
export function TaskRecurrenceDetails({
  series,
  zone,
  stopped,
  stopDate,
}: {
  series: QueryView<components["schemas"]["RecurrenceSeries"]>;
  zone: string;
  stopped: boolean;
  stopDate: string;
}) {
  return (
    <section className={cx("series-summary")}>
      <h3>Repeating task</h3>
      {series.isPending ? (
        <div>
          <LoadingRegion label="Loading repeat details…">
            {[0, 1, 2].map((row) => (
              <span
                key={row}
                style={{ display: "flex", gap: 12, marginBlock: 12 }}
              >
                <Skeleton width={32} height={32} variant="circle" />
                <Skeleton width="70%" height={28} />
              </span>
            ))}
          </LoadingRegion>
        </div>
      ) : series.error ? (
        <p className={cx("error")}>Unable to load repeat details.</p>
      ) : (
        series.data && (
          <>
            <p>
              {recurrenceSummary(
                series.data.cadence,
                series.data.intervalDays,
                series.data.endDate || "",
              )}
            </p>
            <dl>
              <dt>Starts</dt>
              <dd>{dateLabel(series.data.task.scheduledDate)}</dd>
              <dt>Ends</dt>
              <dd>
                {series.data.endDate
                  ? dateLabel(series.data.endDate)
                  : "No end date"}
              </dd>
              <dt>Timezone</dt>
              <dd>{series.data.timezone ?? zone}</dd>
            </dl>
            <small>
              Each occurrence has its own focus goal and sessions. When editing,
              choose this occurrence or current and future occurrences.
            </small>
            {(series.data.stoppedAfter || stopped) && (
              <p>
                Recurrence stopped after{" "}
                {dateLabel(series.data.stoppedAfter || stopDate)}.
              </p>
            )}
          </>
        )
      )}
    </section>
  );
}
export function TaskFocusHistory({
  focus,
  zone,
}: {
  focus: QueryView<FocusHistory>;
  zone: string;
}) {
  const timestamp = (value: string) =>
    DateTime.fromISO(value).setZone(zone).toFormat("MMM d, yyyy HH:mm");
  return (
    <section className={cx("series-summary")}>
      <h3>Focus sessions</h3>
      {focus.isPending ? (
        <div>
          <LoadingRegion label="Loading sessions…">
            {[0, 1, 2].map((row) => (
              <span
                key={row}
                style={{ display: "flex", gap: 12, marginBlock: 12 }}
              >
                <Skeleton width={32} height={32} variant="circle" />
                <Skeleton width="70%" height={28} />
              </span>
            ))}
          </LoadingRegion>
        </div>
      ) : focus.error ? (
        <p role="alert">Unable to load sessions.</p>
      ) : !focus.data?.sessions.length ? (
        <p>No focus sessions yet.</p>
      ) : (
        <ul>
          {focus.data.sessions.map((session) => (
            <li key={session.id}>
              <strong>
                {session.status === "ended"
                  ? "Ended early"
                  : session.status.charAt(0).toUpperCase() +
                    session.status.slice(1)}
              </strong>{" "}
              · {Math.round((session.focusSeconds / 60) * 10) / 10} active min /{" "}
              {session.targetSeconds / 60} min target
              <br />
              <small>
                {timestamp(session.startedAt)} –{" "}
                {session.endedAt ? timestamp(session.endedAt) : "In progress"} ·{" "}
                {zone}
              </small>
            </li>
          ))}
        </ul>
      )}
      <small>
        Active time excludes pauses and breaks. Session targets stay as they
        were when started.
      </small>
    </section>
  );
}
