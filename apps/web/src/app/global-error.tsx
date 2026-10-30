"use client";
import { bindStyles } from "../shared/utils/classNames";
const cx = bindStyles();

import { useEffect } from "react";
import { captureException } from "@sentry/browser";
export default function GlobalError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body>
        <h1>Unable to open TodoCal</h1>
        <button onClick={reset} className={cx("", true)}>
          Try again
        </button>
      </body>
    </html>
  );
}
