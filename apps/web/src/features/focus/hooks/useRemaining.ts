"use client";
import { useEffect, useRef, useState } from "react";
import { remainingSeconds } from "../utils/clock";
import type { FocusState } from "./useFocus";

type ActiveSession = NonNullable<FocusState["active"]>;

// Countdown for the components that display it. The 250ms tick lives here,
// inside the displaying component, instead of in the shared useFocus
// controller: it runs only while a session is running, and it re-renders
// only the component that shows the clock.
export function useRemaining(
  active: ActiveSession | null | undefined,
  dataUpdatedAt: number,
): number {
  const anchor = useRef({ at: performance.now(), version: 0 });
  if (anchor.current.version !== dataUpdatedAt) {
    anchor.current = { at: performance.now(), version: dataUpdatedAt };
  }
  const [tick, setTick] = useState(performance.now());
  const running = active?.status === "running";
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick(performance.now()), 250);
    return () => clearInterval(id);
  }, [running, active?.id]);
  if (!active) return 0;
  return remainingSeconds(
    active,
    anchor.current.at,
    Math.max(tick, anchor.current.at),
  );
}
