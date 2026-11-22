import { it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { SettingsForm } from "./settingsForm";
const notifications = {
  publicKey: "",
  subscriptions: [],
  preferences: {
    taskStart: false,
    deadline: false,
    focusComplete: false,
    breakComplete: false,
    leadMinutes: 5,
    quietStart: "",
    quietEnd: "",
    revision: 2,
  },
};
const read = vi
  .fn()
  .mockImplementation(async (path: string) =>
    path === "/settings" ? { ...settings, revision: 5 } : notifications,
  );
const settings = {
  timezone: "Asia/Tokyo",
  appearance: "light" as const,
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sound: true,
  timerSound: "classic" as const,
  soundVolume: 75,
  revision: 4,
};
it("persists Light/Dark with the account revision", async () => {
  const save = vi
    .fn()
    .mockResolvedValue({ ...settings, appearance: "dark", revision: 5 });
  const refresh = vi.fn();
  render(
    <SettingsForm
      read={read}
      owner="owner"
      settings={settings}
      execute={save}
      refresh={refresh}
      disabled={false}
    />,
  );
  await screen.findByLabelText("Scheduled task reminders");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Save changes|Retry save/ }),
    ).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText("Appearance"), {
    target: { value: "dark" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0]).toBe("/settings/workspace");
  expect(save.mock.calls[0][1].body.settings).toMatchObject({
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
      read={read}
      owner="owner"
      settings={settings}
      execute={save}
      refresh={vi.fn()}
      disabled={false}
    />,
  );
  await screen.findByLabelText("Scheduled task reminders");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Save changes|Retry save/ }),
    ).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText("Appearance"), {
    target: { value: "dark" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("alert");
  view.rerender(
    <SettingsForm
      read={read}
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
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][1].body.settings).toMatchObject({
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
      read={read}
      owner="owner"
      settings={settings}
      execute={save}
      refresh={vi.fn()}
      disabled={false}
    />,
  );
  await screen.findByLabelText("Scheduled task reminders");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Save changes|Retry save/ }),
    ).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText("Appearance"), {
    target: { value: "dark" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("alert");
  view.unmount();
  render(
    <SettingsForm
      read={read}
      owner="owner"
      settings={settings}
      execute={save}
      refresh={vi.fn()}
      disabled={false}
    />,
  );
  await screen.findByLabelText("Scheduled task reminders");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Save changes|Retry save/ }),
    ).toBeEnabled(),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Appearance")).toHaveValue("dark"),
  );
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
        read={read}
        owner="bounds"
        settings={settings}
        execute={save}
        refresh={vi.fn()}
        disabled={false}
      />,
    );
    await screen.findByLabelText("Scheduled task reminders");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Save changes|Retry save/ }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText(label), {
      target: { value: String(value) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
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
      read={read}
      owner="sound-owner"
      settings={settings}
      execute={save}
      refresh={vi.fn()}
      disabled={false}
    />,
  );
  await screen.findByLabelText("Scheduled task reminders");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Save changes|Retry save/ }),
    ).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText("Completion sound"), {
    target: { value: "bell" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][1].body.settings).toMatchObject({
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
      read={read}
      owner="preview-owner"
      settings={settings}
      execute={save}
      refresh={vi.fn()}
      disabled={false}
    />,
  );
  await screen.findByLabelText("Scheduled task reminders");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Save changes|Retry save/ }),
    ).toBeEnabled(),
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

it("saves settings and notification drafts together in one command", async () => {
  const execute = vi.fn().mockResolvedValue({});
  render(
    <SettingsForm
      owner="atomic"
      settings={settings}
      read={read}
      execute={execute}
      refresh={vi.fn()}
      disabled={false}
    />,
  );
  const reminders = await screen.findByLabelText("Scheduled task reminders");
  await waitFor(() => expect(reminders).toBeEnabled());
  fireEvent.click(reminders);
  fireEvent.change(screen.getByLabelText("Sound volume"), {
    target: { value: "60" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(execute.mock.calls[0][0]).toBe("/settings/workspace");
  expect(execute.mock.calls[0][1].body).toMatchObject({
    settings: { soundVolume: 60, expectedRevision: 4 },
    notifications: { taskStart: true, expectedRevision: 2 },
  });
  expect(
    screen.queryByRole("button", { name: "Save notification preferences" }),
  ).not.toBeInTheDocument();
});

it("previews without saving and stops playback explicitly", async () => {
  const stops: ReturnType<typeof vi.fn>[] = [];
  class PreviewContext {
    currentTime = 0;
    destination = {};
    resume = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    createOscillator() {
      const stop = vi.fn();
      stops.push(stop);
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        frequency: { value: 0 },
        start: vi.fn(),
        stop,
        onended: null,
      };
    }
    createGain() {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      };
    }
  }
  vi.stubGlobal("AudioContext", PreviewContext);
  const execute = vi.fn();
  try {
    const view = render(
      <SettingsForm
        owner="stop-preview"
        settings={settings}
        read={read}
        execute={execute}
        refresh={vi.fn()}
        disabled={false}
      />,
    );
    const previewButton = await screen.findByRole("button", {
      name: "Preview sound",
    });
    await waitFor(() => expect(previewButton).toBeEnabled());
    fireEvent.click(previewButton);
    fireEvent.click(
      await screen.findByRole("button", { name: "Stop preview" }),
    );
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((stop) => stop.mock.calls.length === 2)).toBe(true);
    expect(screen.getByRole("button", { name: "Preview sound" })).toBeVisible();
    expect(execute).not.toHaveBeenCalled();
    view.unmount();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("reloads revoked devices on return without replacing unsaved preferences", async () => {
  const device = {
    id: "remote-device",
    deviceName: "Firefox · Linux",
    endpointHash: "remote",
    currentDevice: false,
    createdAt: "2026-11-03T00:00:00Z",
  };
  const read = vi
    .fn()
    .mockResolvedValue({ ...notifications, subscriptions: [device] });
  render(
    <SettingsForm
      owner="returning"
      settings={settings}
      read={read}
      execute={vi.fn()}
      refresh={vi.fn()}
      disabled={false}
    />,
  );
  await screen.findByText("Firefox · Linux");
  await waitFor(() =>
    expect(screen.getByLabelText("Appearance")).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText("Appearance"), {
    target: { value: "dark" },
  });
  fireEvent.click(screen.getByLabelText("Scheduled task reminders"));
  read.mockResolvedValue(notifications);
  fireEvent(window, new Event("focus"));
  await waitFor(() =>
    expect(screen.queryByText("Firefox · Linux")).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Appearance")).toHaveValue("dark");
  expect(screen.getByLabelText("Scheduled task reminders")).toBeChecked();
});

it("searches timezones, selects by keyboard, and uses the device timezone", async () => {
  render(
    <SettingsForm
      read={read}
      owner="timezone-picker"
      settings={settings}
      execute={vi.fn()}
      refresh={vi.fn()}
      disabled={false}
    />,
  );
  const input = await screen.findByRole("combobox", { name: "Timezone" });
  fireEvent.focus(input);
  expect(
    screen.getByRole("option", { name: "Asia/Ho_Chi_Minh" }),
  ).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "ho chi" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveValue("Asia/Ho_Chi_Minh");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Use device timezone" }));
  expect(input).toHaveValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "not a timezone" } });
  expect(
    within(screen.getByRole("listbox")).queryByRole("option"),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
});
