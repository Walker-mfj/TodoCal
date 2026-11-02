"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContentCard } from "../../../shared/components/contentCard/contentCard";
import { ValidatedForm } from "../../../shared/components/validatedForm/validatedForm";
import { useCommand } from "../../../shared/hooks/useCommand";
import { errorMessage, type Execute } from "../../../shared/api/apiClient";
import {
  subscribeBrowserPush,
  supportsBrowserPush,
} from "../utils/browserPush";

import type { components } from "../../../shared/api/apiTypes.generated";
type Preferences = components["schemas"]["NotificationPreferences"];
type State = components["schemas"]["NotificationState"];
export function NotificationSettings({
  owner,
  read,
  execute,
  disabled,
}: {
  owner: string;
  read: Execute;
  execute: Execute;
  disabled: boolean;
}) {
  const [state, setState] = useState<State | null>(null),
    [draft, setDraft] = useState<Preferences | null>(null);
  const [error, setError] = useState(""),
    [preparing, setPreparing] = useState(false),
    [notice, setNotice] = useState("");
  const alive = useRef(false);
  const command = useCommand(execute, `focus:command:${owner}:notifications`);
  const load = useCallback(
    async (keepDraft = false) => {
      try {
        const latest = await read<State>("/notifications", { owner });
        if (!alive.current) return;
        setState(latest);
        setDraft((old) =>
          keepDraft && old
            ? { ...old, revision: latest.preferences.revision }
            : latest.preferences,
        );
        setError("");
      } catch (e) {
        if (alive.current) setError(errorMessage(e));
      }
    },
    [owner, read],
  );
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);
  async function enable() {
    setPreparing(true);
    setError("");
    setNotice("");
    try {
      const subscription = await subscribeBrowserPush(state?.publicKey || "");
      if (!alive.current) return;
      await command.run(
        "/notifications/subscriptions",
        "POST",
        subscription,
        () => {
          setNotice(
            "Notifications enabled for this device. Choose your reminder types below.",
          );
          void load();
        },
      );
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setPreparing(false);
    }
  }
  const busy = disabled || preparing || command.busy || command.uncertain;
  return (
    <ContentCard>
      <h2>Notifications</h2>
      <p>
        These settings control Web Push reminders, including when the app is
        closed. Enable each device separately. Delivery can be delayed by your
        browser or network. Reminders never start a timer.
      </p>
      <p>
        While a tab is open, the Focus timer can also show a browser
        notification if permission is granted. Turning off Focus session
        completed below only stops Web Push; it does not stop these open-tab
        notifications. To stop both, block notifications for this site in your
        browser settings. With both enabled, you may receive two completion
        notifications. Timer sound is controlled separately in Settings.
      </p>
      {(error || command.error) && <p role="alert">{error || command.error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!state && (
        <p aria-busy={!error}>
          {error
            ? "Notification preferences could not be loaded."
            : "Loading notification preferences…"}
        </p>
      )}
      {!state && error && (
        <button onClick={() => void load()}>Retry loading notifications</button>
      )}
      {state && draft && (
        <>
          {!state.publicKey ? (
            <p>Background notifications are not configured yet.</p>
          ) : !supportsBrowserPush() ? (
            <p>
              This browser does not support background notifications. On iOS,
              install TodoCal on your Home Screen first.
            </p>
          ) : (
            <button disabled={busy} onClick={() => void enable()}>
              {preparing ? "Enabling…" : "Enable on this device"}
            </button>
          )}
          <ValidatedForm
            onSubmit={(e) => {
              e.preventDefault();
              setNotice("");
              const { revision, ...preferences } = draft;
              void command.run(
                "/notifications/preferences",
                "PUT",
                { ...preferences, expectedRevision: revision },
                () => {
                  setNotice("Notification preferences saved.");
                  void load();
                },
              );
            }}
          >
            <fieldset disabled={busy}>
              <legend>Reminder types</legend>
              {(
                [
                  ["taskStart", "Scheduled task reminders"],
                  ["deadline", "Task deadline reminders"],
                  ["focusComplete", "Focus session completed"],
                  ["breakComplete", "Break completed"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={draft[key]}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
              <label>
                Reminder lead minutes
                <input
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
              <p>
                Scheduled tasks get a reminder at their start and, if above
                zero, this many minutes before. Deadlines use the same lead
                time.
              </p>
              <label>
                Quiet hours start
                <input
                  type="time"
                  value={draft.quietStart}
                  required={!!draft.quietEnd}
                  onChange={(e) =>
                    setDraft({ ...draft, quietStart: e.target.value })
                  }
                />
              </label>
              <label>
                Quiet hours end
                <input
                  type="time"
                  value={draft.quietEnd}
                  required={!!draft.quietStart}
                  onChange={(e) =>
                    setDraft({ ...draft, quietEnd: e.target.value })
                  }
                />
              </label>
              <p>
                Quiet hours use your account timezone. Reminders during quiet
                hours are skipped. Leave both fields empty to turn quiet hours
                off.
              </p>
            </fieldset>
            <button disabled={busy || command.conflict}>
              Save notification preferences
            </button>
          </ValidatedForm>
          {command.conflict && (
            <button
              disabled={disabled}
              onClick={async () => {
                await load(true);
                command.dismissError();
              }}
            >
              Load latest revision and keep draft
            </button>
          )}
          {command.uncertain && (
            <button
              disabled={disabled || command.busy}
              onClick={() => void command.run("", "", {}, () => void load())}
            >
              Retry unconfirmed notification change
            </button>
          )}
          <h3>Enabled devices</h3>
          {state.subscriptions.length === 0 ? (
            <p>No devices enabled.</p>
          ) : (
            <ul>
              {state.subscriptions.map((device, index) => (
                <li key={device.id}>
                  {device.currentDevice ? "This login" : "Another login"} ·{" "}
                  {new Date(device.createdAt).toLocaleDateString()}{" "}
                  <button
                    disabled={busy}
                    aria-label={`Revoke notification device ${index + 1}`}
                    onClick={() =>
                      void command.run(
                        `/notifications/subscriptions/${device.id}`,
                        "DELETE",
                        {},
                        () => {
                          setNotice("Device notifications revoked.");
                          void load();
                        },
                      )
                    }
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p>
            Signing out or expiry of a device’s login disables its deliveries.
            Sign in and enable the device again to resume.
          </p>
        </>
      )}
    </ContentCard>
  );
}
