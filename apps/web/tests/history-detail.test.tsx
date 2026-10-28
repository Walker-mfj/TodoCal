import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskDetail } from "../src/features/tasks/detail";
vi.mock("../src/app/providers", () => ({
  useOwnedQuery: (name: string) => ({
    data:
      name === "historical-day"
        ? { entries: [{ task: { id: "one" }, groupName: "Original group" }] }
        : undefined,
    isPending: false,
  }),
}));
it("shows the finalized group name after the current group is renamed", () => {
  const task = {
    id: "one",
    title: "Historical task",
    description: "",
    groupId: "group",
    priority: "medium" as const,
    scheduledDate: "2026-10-20",
    startTime: null,
    endTime: null,
    deadline: null,
    estimatedPomodoros: null,
    status: "complete" as const,
    revision: 1,
    createdAt: "",
    updatedAt: "",
    seriesId: null,
    originalOccurrenceDate: null,
  };
  render(
    <TaskDetail
      task={task}
      historical
      groups={[
        { id: "group", name: "Renamed group", color: "#123456", revision: 2 },
      ]}
      execute={vi.fn()}
      disabled={false}
      onClose={vi.fn()}
      onEdit={vi.fn()}
      onCurrent={vi.fn()}
      onComplete={vi.fn()}
      onDeleted={vi.fn()}
    />,
  );
  expect(screen.getByText("Original group")).toBeVisible();
  expect(screen.queryByText("Renamed group")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Edit task" }),
  ).toBeEnabled();
});
