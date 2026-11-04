"use client";
import { useEffect, useRef, useState } from "react";
import { useCommand } from "../../../shared/hooks/useCommand";
import { errorMessage, type Execute } from "../../../shared/api/apiClient";
import {
  currentBrowserPushHash,
  subscribeBrowserPush,
  supportsBrowserPush,
} from "../utils/browserPush";
import { bindStyles } from "../../../shared/utils/classNames";
import styles from "../../settings/components/settingsForm/settingsForm.module.css";
import type { components } from "../../../shared/api/apiTypes.generated";
export type NotificationPreferences =
  components["schemas"]["NotificationPreferences"];
export type NotificationState = components["schemas"]["NotificationState"];
const cx = bindStyles(styles);

export function NotificationSettings({
  owner,
  state,
  draft,
  setDraft,
  execute,
  reload,
  disabled,
  onPendingChange,
}: {
  owner: string;
  state: NotificationState;
  draft: NotificationPreferences;
  setDraft: (draft: NotificationPreferences) => void;
  execute: Execute;
  reload: () => Promise<unknown>;
  disabled: boolean;
  onPendingChange: (pending: boolean) => void;
}) {
  const [localHash, setLocalHash] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(false);
  const command = useCommand(
    execute,
    `focus:command:${owner}:notification-devices`,
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const hash = await currentBrowserPushHash();
        if (active) setLocalHash(hash);
      } catch {
        if (active) setLocalHash(null);
      } finally {
        if (active) setChecking(false);
      }
    };
    void check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [state]);
  const pending = preparing || command.busy || command.uncertain;
  useEffect(() => {
    onPendingChange(pending);
  }, [pending, onPendingChange]);
  const busy = disabled || pending;
  const currentDevice = state.subscriptions.find(
    (device) => device.endpointHash === localHash && device.currentDevice,
  );
  function revokeButton(device: NotificationState["subscriptions"][number]) {
    return (
      <button
        type="button"
        className={cx("", true)}
        disabled={busy}
        aria-label={`Revoke notifications for ${device.deviceName || "browser"}`}
        onClick={() =>
          void command.run(
            `/notifications/subscriptions/${device.id}`,
            "DELETE",
            {},
            () => {
              setNotice("Device notifications revoked.");
              void reload();
            },
          )
        }
      >
        Revoke
      </button>
    );
  }
  async function enable() {
    setPreparing(true);
    setError("");
    setNotice("");
    try {
      const subscription = await subscribeBrowserPush(state.publicKey || "");
      if (!alive.current) return;
      await command.run(
        "/notifications/subscriptions",
        "POST",
        subscription,
        () => {
          setNotice("Device notifications enabled.");
          void reload();
        },
      );
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setPreparing(false);
    }
  }
  return (
    <>
      <section
        className={cx("section")}
        aria-labelledby="notifications-heading"
      >
        <h3 id="notifications-heading">Notifications</h3>
        <p className={cx("muted")}>
          Choose your reminders. Enable each device separately to receive them
          when TodoCal is closed.
        </p>
        <div className={cx("device-status")}>
          {checking ? (
            <p role="status">Checking this device…</p>
          ) : currentDevice ? (
            <div>
              <strong>Notifications enabled on this device</strong>
              <p className={cx("muted")}>
                {currentDevice.deviceName || "This browser"}
              </p>
            </div>
          ) : (
            <div>
              <strong>Notifications are off on this device</strong>
              <p className={cx("muted")}>
                Your reminder preferences are saved across devices.
              </p>
            </div>
          )}
          {!checking && currentDevice && revokeButton(currentDevice)}
          {!checking &&
            !currentDevice &&
            state.publicKey &&
            supportsBrowserPush() && (
              <button
                type="button"
                className={cx("", true)}
                disabled={busy}
                onClick={() => void enable()}
              >
                {preparing ? "Enabling…" : "Enable on this device"}
              </button>
            )}
        </div>
        {!state.publicKey && (
          <p className={cx("muted")}>
            Background notifications are not configured yet.
          </p>
        )}
        {!!state.publicKey && !supportsBrowserPush() && (
          <p>
            This browser does not support background notifications. On iOS,
            install TodoCal on your Home Screen first.
          </p>
        )}
        {typeof Notification !== "undefined" &&
          Notification.permission === "denied" && (
            <p>
              Notifications are blocked in browser settings. Allow notifications
              there, then enable this device.
            </p>
          )}
        {(error || command.error) && (
          <p role="alert" className={cx("error")}>
            {error || command.error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <fieldset className={cx("", true)} disabled={disabled || pending}>
          <legend className={cx("sr-only")}>Reminder types</legend>
          <div className={cx("reminders")}>
            {(
              [
                ["taskStart", "Scheduled task reminders"],
                ["deadline", "Task deadline reminders"],
                ["focusComplete", "Focus session completed"],
                ["breakComplete", "Break completed"],
              ] as const
            ).map(([key, label]) => (
              <label className={cx("check-label", true)} key={key}>
                <input
                  className={cx("", true)}
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.checked })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <label className={cx("", true)}>
            Reminder lead minutes
            <input
              className={cx("", true)}
              type="number"
              min={0}
              max={1440}
              required
              value={draft.leadMinutes}
              onChange={(e) =>
                setDraft({ ...draft, leadMinutes: +e.target.value })
              }
            />
          </label>
          <p className={cx("muted")}>
            Tasks get a reminder at their start and this many minutes
            beforehand. Deadlines use the same lead time.
          </p>
          <div className={cx("form-row")}>
            <label className={cx("", true)}>
              Quiet hours start
              <input
                className={cx("", true)}
                type="time"
                value={draft.quietStart}
                required={!!draft.quietEnd}
                onChange={(e) =>
                  setDraft({ ...draft, quietStart: e.target.value })
                }
              />
            </label>
            <label className={cx("", true)}>
              Quiet hours end
              <input
                className={cx("", true)}
                type="time"
                value={draft.quietEnd}
                required={!!draft.quietStart}
                onChange={(e) =>
                  setDraft({ ...draft, quietEnd: e.target.value })
                }
              />
            </label>
          </div>
          <p className={cx("muted")}>
            Quiet hours use your account timezone. Reminders during quiet hours
            are skipped. Leave both fields empty to turn them off.
          </p>
        </fieldset>
        <details className={cx("details")}>
          <summary>About delivery</summary>
          <p>
            Delivery can be delayed by your browser or network. Reminders never
            start a timer. When TodoCal is open, the timer can also show a
            browser notification if permission is granted, independently of
            these reminder preferences. Both may appear. Block site
            notifications in your browser to stop both. Timer sound is
            controlled separately above.
          </p>
        </details>
      </section>
      <section className={cx("section")} aria-labelledby="devices-heading">
        <h3 id="devices-heading">Devices</h3>
        <p className={cx("muted")}>
          Device changes take effect immediately. Signing out disables
          notifications for that login.
        </p>
        {state.subscriptions.length === 0 ? (
          <p>No devices enabled.</p>
        ) : (
          <ul className={cx("devices")}>
            {state.subscriptions.map((device) => (
              <li key={device.id}>
                <div>
                  <strong>{device.deviceName || "Browser"}</strong>
                  <p className={cx("muted")}>
                    {device.id === currentDevice?.id ? "This device · " : ""}
                    Enabled {new Date(device.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {device.id !== currentDevice?.id && revokeButton(device)}
              </li>
            ))}
          </ul>
        )}
        {command.conflict && (
          <button
            type="button"
            className={cx("", true)}
            disabled={busy}
            onClick={async () => {
              await reload();
              command.dismissError();
            }}
          >
            Refresh devices
          </button>
        )}
        {command.uncertain && (
          <button
            type="button"
            className={cx("", true)}
            disabled={disabled || command.busy}
            onClick={() => void command.run("", "", {}, () => void reload())}
          >
            Retry unconfirmed device change
          </button>
        )}
      </section>
    </>
  );
}
