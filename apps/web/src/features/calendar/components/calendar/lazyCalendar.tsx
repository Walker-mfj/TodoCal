"use client";
import dynamic from "next/dynamic";
import { bindStyles } from "../../../../shared/utils/classNames";
const cx = bindStyles();
export const Calendar = dynamic(() => import("./calendar"), {
  ssr: false,
  loading: () => <div className={cx("loading")}>Loading calendar…</div>,
});
