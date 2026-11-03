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
  timerSound: "classic" as const,
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

it.each([
  ["Focus minutes", 181, "Focus minutes must be no more than 180."],
  ["Short break minutes", 61, "Short break minutes must be no more than 60."],
  ["Long break minutes", 61, "Long break minutes must be no more than 60."],
  ["Focus minutes", 0, "Focus minutes must be at least 1."],
  [
    "Short break minutes",
    1.5,
    "Check short break minutes and enter a valid value.",
  ],
])(
  "keeps invalid %s input and explains the limit",
  async (label, value, message) => {
    const save = vi.fn();
    render(
      <SettingsForm
        owner="bounds"
        settings={settings}
        execute={save}
        refresh={vi.fn()}
        disabled={false}
      />,
    );
    fireEvent.change(screen.getByLabelText(label), {
      target: { value: String(value) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText(label)).toHaveFocus();
    expect(screen.getByLabelText(label)).toHaveValue(value);
    expect(save).not.toHaveBeenCalled();
  },
);

it("saves the selected completion sound and disables selection when muted", async () => {
  const save = vi.fn().mockResolvedValue({});
  render(
    <SettingsForm
      owner="sound-owner"
      settings={settings}
      execute={save}
      refresh={vi.fn()}
      disabled={false}
    />,
  );
  fireEvent.change(screen.getByLabelText("Completion sound"), {
    target: { value: "bell" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][1].body).toMatchObject({
    timerSound: "bell",
    sound: true,
  });
  fireEvent.click(screen.getByLabelText("Timer sound"));
  expect(screen.getByLabelText("Completion sound")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Preview sound" })).toBeDisabled();
});

it("offers all eight cues and reports unavailable preview without saving", async () => {
  const save = vi.fn();
  render(
    <SettingsForm
      owner="preview-owner"
      settings={settings}
      execute={save}
      refresh={vi.fn()}
      disabled={false}
    />,
  );
  const selector = screen.getByLabelText("Completion sound");
  expect(selector.querySelectorAll("option")).toHaveLength(8);
  for (const value of [
    "classic",
    "bell",
    "soft_bell",
    "double_bell",
    "singing_bowl",
    "doorbell",
    "chime",
    "digital",
  ]) {
    fireEvent.change(selector, { target: { value } });
    expect(selector).toHaveValue(value);
  }
  fireEvent.click(screen.getByRole("button", { name: "Preview sound" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Sound preview is unavailable",
  );
  expect(save).not.toHaveBeenCalled();
});
