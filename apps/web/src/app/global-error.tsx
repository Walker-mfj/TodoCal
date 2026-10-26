"use client";
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
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
