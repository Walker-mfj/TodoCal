"use client";
import { useEffect, useState } from "react";
import { remainingSeconds } from "../utils/clock";
import type { FocusState } from "./useFocus";

type ActiveSession = NonNullable<FocusState["active"]>;

// Countdown for the components that display it. The 250ms tick lives here,
// inside the displaying component, instead of in the shared useFocus
// controller. Every display uses the same receivedAt anchor for this
// server snapshot, including displays that mount after the timer starts.
export function useRemaining(
  active: ActiveSession | null | undefined,
  receivedAt: number,
): number {
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
    receivedAt,
    Math.max(tick, performance.now(), receivedAt),
  );
}
