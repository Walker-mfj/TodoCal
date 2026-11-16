"use client";
import { useEffect, useState } from "react";
import { DateTime } from "luxon";

// Calendar slots represent account-local wall time on a UTC grid.
export function useWallClock(zone: string) {
  const [timestamp, setTimestamp] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = Date.now();
      setTimestamp(now);
      timer = setTimeout(refresh, 60_000 - (now % 60_000));
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return DateTime.fromMillis(timestamp)
    .setZone(zone)
    .toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
}
