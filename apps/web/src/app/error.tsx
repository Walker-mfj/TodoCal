"use client";
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
      <button onClick={reset}>Try again</button>
    </main>
  );
}
