"use client";
import { bindStyles } from "../../../shared/utils/classNames";
import styles from "./workspaceHeading.module.css";
const cx = bindStyles(styles);
import { dateLabel } from "../../../shared/utils/dateUtils";
export function WorkspaceHeading({
  page,
  date,
  zone,
}: {
  page: string;
  date: string;
  zone: string;
}) {
  return (
    <header className={cx("workspace-heading")}>
      <div>
        <p className={cx("eyebrow")}>
          {dateLabel(date, "EEEE, MMMM d").toUpperCase()} · {zone}
        </p>
        <h1>
          {page === "calendar"
            ? "A week with room to focus."
            : page === "tasks"
              ? "One thing at a time."
              : page === "progress"
                ? "See how far you’ve come."
                : page === "groups"
                  ? "A place for every plan."
                  : "Make yourself at home."}
        </h1>
        <p className={cx("muted")}>
          {page === "calendar"
            ? "A clear plan. A little breathing room."
            : page === "progress"
              ? "Small steps add up. Explore each day of your week or month."
              : "Your plans, at your own pace."}
        </p>
      </div>
      <span className={cx("workspace-label")}>TODOCAL</span>
    </header>
  );
}
