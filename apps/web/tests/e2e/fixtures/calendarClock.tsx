import React from "react";
import { createRoot } from "react-dom/client";
import Calendar from "../../../src/features/calendar/components/calendar/calendar";
import { useToday } from "../../../src/shared/hooks/useToday";
import "../../../src/shared/styles/tokens.css";

function ClockCalendar() {
  const date = useToday("Asia/Tokyo");
  return (
    <div style={{ height: 1600 }}>
      <Calendar
        timezone="Asia/Tokyo"
        today={date}
        days={[]}
        groups={[]}
        onRange={() => {}}
        onTask={() => {}}
        onCreate={() => {}}
        filter={() => true}
        disabled={false}
        onSchedule={() => {}}
        onScheduleError={() => {}}
        focus={{} as never}
        defaultFocusMinutes={25}
        onOpenFocus={() => {}}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<ClockCalendar />);
