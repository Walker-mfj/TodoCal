import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsForm } from "./settingsForm";
const settings = {
  timezone: "Asia/Tokyo",
  appearance: "light" as const,
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sound: true,
  revision: 4,
};
it("persists Light/Dark with the account revision", async () => {
  const save = vi
    .fn()
    .mockResolvedValue({ ...settings, appearance: "dark", revision: 5 });
  const refresh = vi.fn();
  render(
    <SettingsForm
      owner="owner"
      settings={settings}
      execute={save}
      refresh={refresh}
      disabled={false}
    />,
  );
  fireEvent.change(screen.getByLabelText("Appearance"), {
    target: { value: "dark" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0]).toBe("/settings");
  expect(save.mock.calls[0][1].body).toMatchObject({
    appearance: "dark",
    expectedRevision: 4,
  });
  await waitFor(() => expect(refresh).toHaveBeenCalled());
});
it("recovers a conflict without silently replacing the draft", async () => {
  const { ApiError } = await import("../../../../shared/api/apiClient");
  const save = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(409, "Changed elsewhere"))
    .mockResolvedValue({});
  const view = render(
    <SettingsForm
      owner="owner"
      settings={settings}
      execute={save}
      refresh={vi.fn()}
      disabled={false}
    />,
  );
  fireEvent.change(screen.getByLabelText("Appearance"), {
    target: { value: "dark" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByRole("alert");
  view.rerender(
    <SettingsForm
      owner="owner"
      settings={{ ...settings, revision: 5 }}
      execute={save}
      refresh={vi.fn()}
      disabled={false}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Reapply draft to latest settings" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][1].body).toMatchObject({
    appearance: "dark",
    expectedRevision: 5,
  });
});
it("restores settings draft and exact uncertain command for the original account", async () => {
  const { ApiError } = await import("../../../../shared/api/apiClient");
  const save = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(401, "Expired"))
    .mockResolvedValue({});
  const view = render(
    <SettingsForm
      owner="owner"
      settings={settings}
      execute={save}
      refresh={vi.fn()}
      disabled={false}
    />,
  );
  fireEvent.change(screen.getByLabelText("Appearance"), {
    target: { value: "dark" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByRole("alert");
  view.unmount();
  render(
    <SettingsForm
      owner="owner"
      settings={settings}
      execute={save}
      refresh={vi.fn()}
      disabled={false}
    />,
  );
  expect(screen.getByLabelText("Appearance")).toHaveValue("dark");
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][1]).toEqual(save.mock.calls[0][1]);
});
