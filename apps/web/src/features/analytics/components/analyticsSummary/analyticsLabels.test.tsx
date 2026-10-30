import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { AnalyticsSummary } from "./analyticsSummary";
it("distinguishes scheduled-plan completion from actual completion dates", () => {
  render(
    <AnalyticsSummary
      report={
        {
          metrics: {
            planned: 2,
            completed: 1,
            percentage: 50,
            completedTasks: 1,
            focusSeconds: 0,
            pomodoros: 0,
            completeDays: 0,
            plannedDays: 1,
          },
          comparison: {
            from: "2026-10-01",
            through: "2026-10-07T12:00:00Z",
            percentagePointChange: null,
            focusSecondsChange: null,
          },
          through: "2026-10-14T12:00:00Z",
          timezone: "Asia/Tokyo",
          days: [],
        } as any
      }
      onDay={() => {}}
    />,
  );
  expect(screen.getByText(/By scheduled date/)).toBeInTheDocument();
  expect(screen.getByText(/By completion date/)).toBeInTheDocument();
});
