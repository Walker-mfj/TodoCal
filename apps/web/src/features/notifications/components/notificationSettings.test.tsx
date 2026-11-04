import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationSettings } from "./notificationSettings";
import {
  currentBrowserPushHash,
  subscribeBrowserPush,
} from "../utils/browserPush";
vi.mock("../utils/browserPush", () => ({
  currentBrowserPushHash: vi.fn(),
  subscribeBrowserPush: vi.fn(),
  supportsBrowserPush: () => true,
}));
afterEach(() => vi.unstubAllGlobals());
const preferences = {
  taskStart: false,
  deadline: false,
  focusComplete: false,
  breakComplete: false,
  leadMinutes: 5,
  quietStart: "",
  quietEnd: "",
  revision: 1,
};
const device = {
  id: "device-1",
  deviceName: "Chrome · macOS",
  endpointHash: "local",
  currentDevice: true,
  createdAt: "2026-11-03T00:00:00Z",
};
function setup(hash: string | null = "local", subscriptions = [device]) {
  vi.mocked(currentBrowserPushHash).mockResolvedValue(hash);
  const execute = vi.fn().mockResolvedValue({});
  const reload = vi.fn().mockResolvedValue({});
  const setDraft = vi.fn();
  render(
    <NotificationSettings
      owner="a"
      state={{ publicKey: "key", preferences, subscriptions }}
      draft={preferences}
      setDraft={setDraft}
      execute={execute}
      reload={reload}
      disabled={false}
      onPendingChange={vi.fn()}
    />,
  );
  return { execute, reload, setDraft };
}
it("shows verified enabled device with Revoke and never offers redundant Enable", async () => {
  const { execute, reload } = setup();
  expect(
    await screen.findByText("Notifications enabled on this device"),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Enable on this device" }),
  ).not.toBeInTheDocument();
  expect(subscribeBrowserPush).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Revoke notifications for Chrome · macOS",
    }),
  );
  await waitFor(() =>
    expect(execute).toHaveBeenCalledWith(
      "/notifications/subscriptions/device-1",
      expect.objectContaining({ method: "DELETE" }),
    ),
  );
  await waitFor(() => expect(reload).toHaveBeenCalled());
});
it.each([null, "other-endpoint"])(
  "does not claim enabled for missing or mismatched local subscription (%s)",
  async (hash) => {
    setup(hash);
    expect(
      await screen.findByRole("button", { name: "Enable on this device" }),
    ).toBeVisible();
    expect(
      screen.queryByText("Notifications enabled on this device"),
    ).not.toBeInTheDocument();
  },
);
it("keeps reminder editing controlled by the unified form without its own save", async () => {
  const { setDraft, execute } = setup();
  await screen.findByText("Notifications enabled on this device");
  fireEvent.click(screen.getByLabelText("Scheduled task reminders"));
  expect(setDraft).toHaveBeenCalledWith({ ...preferences, taskStart: true });
  expect(execute).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: /Save/ }),
  ).not.toBeInTheDocument();
});
it("disables device actions while a revoke is pending", async () => {
  const { execute } = setup();
  await screen.findByText("Notifications enabled on this device");
  execute.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: /Revoke notifications/ }));
  expect(
    screen.getByRole("button", { name: /Revoke notifications/ }),
  ).toBeDisabled();
});
