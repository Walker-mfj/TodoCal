import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NotificationSettings } from "./notificationSettings";
import { ApiError } from "../../../shared/api/apiClient";
const data = {
  publicKey: "",
  preferences: {
    taskStart: false,
    deadline: false,
    focusComplete: false,
    breakComplete: false,
    leadMinutes: 5,
    quietStart: "",
    quietEnd: "",
    revision: 1,
  },
  subscriptions: [],
};
it("loads opt-in preferences without requesting browser permission", async () => {
  const read = vi.fn().mockResolvedValue(data);
  const execute = vi.fn();
  render(
    <NotificationSettings
      owner="a"
      read={read}
      execute={execute}
      disabled={false}
    />,
  );
  expect(
    await screen.findByLabelText("Scheduled task reminders"),
  ).not.toBeChecked();
  expect(
    screen.getByText("Background notifications are not configured yet."),
  ).toBeVisible();
  fireEvent.click(screen.getByLabelText("Scheduled task reminders"));
  fireEvent.click(
    screen.getByRole("button", { name: "Save notification preferences" }),
  );
  await waitFor(() => expect(execute).toHaveBeenCalled());
  expect(execute.mock.calls[0][1].body).toMatchObject({
    expectedRevision: 1,
    taskStart: true,
  });
});
it("keeps a draft on conflict and requires an explicit reapply", async () => {
  const read = vi.fn().mockResolvedValue(data);
  const execute = vi.fn().mockRejectedValue(new ApiError(409, "Changed"));
  render(
    <NotificationSettings
      owner="b"
      read={read}
      execute={execute}
      disabled={false}
    />,
  );
  fireEvent.click(await screen.findByLabelText("Scheduled task reminders"));
  fireEvent.click(
    screen.getByRole("button", { name: "Save notification preferences" }),
  );
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Scheduled task reminders")).toBeChecked();
  read.mockResolvedValue({
    ...data,
    preferences: { ...data.preferences, revision: 2 },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Load latest revision and keep draft" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", {
        name: "Load latest revision and keep draft",
      }),
    ).not.toBeInTheDocument(),
  );
  execute.mockResolvedValue({});
  fireEvent.click(
    screen.getByRole("button", { name: "Save notification preferences" }),
  );
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  expect(execute.mock.calls[1][1].body).toMatchObject({
    taskStart: true,
    expectedRevision: 2,
  });
});
