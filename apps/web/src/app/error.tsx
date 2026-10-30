"use client";
import { bindStyles } from "../shared/utils/classNames";
const cx = bindStyles();

import { useEffect } from "react";
import { captureException } from "@sentry/browser";
export default function ErrorPage({
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
    <main>
      <h1>Something went wrong</h1>
      <p>Please try again.</p>
      <button onClick={reset} className={cx("", true)}>
        Try again
      </button>
    </main>
  );
}
