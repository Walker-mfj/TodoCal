"use client";
import { useEffect, useState } from "react";
import { today } from "../utils/dateUtils";

export function useToday(zone: string) {
  const [date, setDate] = useState(() => today(zone));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      // Equal dates bail out of React rendering; only rollover changes state.
      setDate(today(zone));
      timer = setTimeout(refresh, 60_000 - (Date.now() % 60_000));
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [zone]);
  return date;
}
