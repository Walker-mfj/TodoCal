"use client";
import { usePendingAction } from "../../../../shared/hooks/usePendingAction";
import { LoadingIndicator } from "../../../../shared/components/loadingIndicator/loadingIndicator";

import { LoadingRegion } from "../../../../shared/components/loadingRegion/loadingRegion";

import { Skeleton } from "../../../../shared/components/skeleton/skeleton";
import { useCallback, useEffect, useRef, useState } from "react";
import { playTimerSound, timerSounds } from "../../../focus";
import { ContentCard } from "../../../../shared/components/contentCard/contentCard";
import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./settingsForm.module.css";
import { TimezonePicker } from "./timezonePicker";
import {
  NotificationSettings,
  type NotificationState,
  type NotificationPreferences,
} from "../../../notifications";
import { errorMessage } from "../../../../shared/api/apiClient";
const cx = bindStyles(styles);

import { ValidatedForm } from "../../../../shared/components/validatedForm/validatedForm";
import { useAccountDraft } from "../../../../shared/hooks/useAccountDraft";
import type { Settings } from "../../../../shared/api/domainTypes";
import type { Execute } from "../../../../shared/api/apiClient";
import { useCommand } from "../../../../shared/hooks/useCommand";
type Props = {
  owner: string;
  settings: Settings;
  read: Execute;
  execute: Execute;
  refresh: () => unknown;
  disabled: boolean;
};
export function SettingsForm(props: Props) {
  const { read, owner } = props;
  const [state, setState] = useState<NotificationState | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(false);
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const latest = await read<NotificationState>("/notifications", {
        owner,
      });
      if (alive.current && version === loadVersion.current) {
        setState(latest);
        setError("");
      }
      return latest;
    } catch (e) {
      if (alive.current && version === loadVersion.current)
        setError(errorMessage(e));
      return null;
    }
  }, [read, owner]);
  useEffect(() => {
    alive.current = true;
    void load();
    const onReturn = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("focus-calendar");
    if (channel) channel.onmessage = onReturn;
    return () => {
      alive.current = false;
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
      channel?.close();
    };
  }, [load]);
  if (!state)
    return (
      <ContentCard>
        <h2>Settings</h2>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className={cx("", true)} onClick={() => void load()}>
              Retry loading settings
            </button>
          </>
        ) : (
          <p>
            <LoadingRegion label="Loading settings…">
              {[0, 1, 2, 3].map((row) => (
                <span key={row} style={{ display: "block", marginBlock: 16 }}>
                  <Skeleton width="40%" />
                  <Skeleton width="100%" height={40} />
                </span>
              ))}
            </LoadingRegion>
          </p>
        )}
      </ContentCard>
    );
  return (
    <SettingsEditor {...props} state={state} reload={load} loadError={error} />
  );
}
function SettingsEditor({
  owner,
  settings,
  read,
  execute,
  refresh,
  disabled,
  state,
  reload,
  loadError,
}: Props & {
  state: NotificationState;
  reload: () => Promise<NotificationState | null>;
  loadError: string;
}) {
  const {
    draft: combined,
    setDraft: setCombined,
    ready,
  } = useAccountDraft(`focus:form:${owner}:workspace-settings`, {
    settings,
    notifications: state.preferences,
  });
  const draft = combined.settings;
  const setDraft = (value: Settings | ((old: Settings) => Settings)) =>
    setCombined((old) => ({
      ...old,
      settings: typeof value === "function" ? value(old.settings) : value,
    }));
  const setNotifications = (notifications: NotificationPreferences) =>
    setCombined((old) => ({ ...old, notifications }));
  const [devicePending, setDevicePending] = useState(false);
  const [notice, setNotice] = useState("");
  const actions = usePendingAction();
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [playing, setPlaying] = useState(false);
  const previewTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewGeneration = useRef(0);
  const preview = useRef<AudioContext | null>(null);
  const stopPreview = useRef<(() => void) | null>(null);
  const [previewError, setPreviewError] = useState("");
  useEffect(
    () => () => {
      previewGeneration.current++;
      stopPreview.current?.();
      if (previewTimeout.current) clearTimeout(previewTimeout.current);
      void preview.current?.close().catch(() => {});
    },
    [],
  );
  useEffect(() => {
    previewGeneration.current++;
    stopPreview.current?.();
    if (previewTimeout.current) clearTimeout(previewTimeout.current);
    setPlaying(false);
  }, [draft.sound, draft.timerSound, draft.soundVolume]);
  const previewSound = async () => {
    setPreviewError("");
    const generation = ++previewGeneration.current;
    try {
      stopPreview.current?.();
      if (previewTimeout.current) clearTimeout(previewTimeout.current);
      preview.current ??= new AudioContext();
      await preview.current.resume();
      if (generation !== previewGeneration.current) return;
      stopPreview.current = playTimerSound(
        preview.current,
        draft.timerSound,
        draft.soundVolume ?? 75,
      );
      setPlaying(true);
      previewTimeout.current = setTimeout(() => setPlaying(false), 4800);
    } catch {
      if (generation !== previewGeneration.current) return;
      setPreviewError(
        "Sound preview is unavailable in this browser. Please try again.",
      );
    }
  };
  const command = useCommand(
    execute,
    `focus:command:${owner}:workspace-settings`,
  );
  async function recoverDraft(keep: boolean) {
    setRecovering(true);
    setRecoveryError("");
    try {
      const [latestSettings, latestNotifications] = await Promise.all([
        read<Settings>("/settings", { owner }),
        reload(),
      ]);
      if (!latestNotifications)
        throw new Error(
          "Could not load the latest notification preferences. Try again.",
        );
      setCombined((old) =>
        keep
          ? {
              settings: { ...old.settings, revision: latestSettings.revision },
              notifications: {
                ...old.notifications,
                revision: latestNotifications.preferences.revision,
              },
            }
          : {
              settings: latestSettings,
              notifications: latestNotifications.preferences,
            },
      );
      command.dismissError();
    } catch (e) {
      setRecoveryError(errorMessage(e));
    } finally {
      setRecovering(false);
    }
  }
  const field = (key: keyof Settings, value: string | number | boolean) =>
    setDraft((d) => ({ ...d, [key]: value }));
  return (
    <ContentCard>
      <p className={cx("eyebrow")}>MAKE IT YOURS</p>
      <h2>Settings</h2>
      <p className={cx("muted")}>
        Your workspace, focus routine, and reminders in one place.
      </p>
      <ValidatedForm
        onSubmit={(e) => {
          e.preventDefault();
          setNotice("");
          const { revision, ...body } = draft;
          const { revision: notificationRevision, ...notifications } =
            combined.notifications;
          void command.run(
            "/settings/workspace",
            "PATCH",
            {
              settings: {
                ...body,
                soundVolume: body.soundVolume ?? 75,
                expectedRevision: revision,
              },
              notifications: {
                ...notifications,
                expectedRevision: notificationRevision,
              },
            },
            () => {
              setCombined((old) => ({
                settings: { ...old.settings, revision: revision + 1 },
                notifications: {
                  ...old.notifications,
                  revision: notificationRevision + 1,
                },
              }));
              setNotice("Changes saved.");
              void refresh();
              void reload();
            },
          );
        }}
      >
        <fieldset
          disabled={
            !ready ||
            disabled ||
            devicePending ||
            recovering ||
            command.busy ||
            command.uncertain
          }
          className={cx("", true)}
        >
          <section className={cx("section")}>
            <h3>Workspace</h3>
            <label className={cx("", true)}>
              Appearance
              <span className={cx("select-wrap")}>
                <select
                  value={draft.appearance}
                  onChange={(e) => field("appearance", e.target.value)}
                  className={cx("", true)}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </span>
            </label>
            <TimezonePicker
              value={draft.timezone}
              onChange={(zone) => field("timezone", zone)}
            />
            <p className={cx("muted")}>
              Timed tasks and deadlines keep the same actual moments; their
              displayed dates and times change. Date-only tasks and saved
              history keep their dates. Changing timezone can finalize days that
              have ended.
            </p>
          </section>
          <section className={cx("section")}>
            <h3>Focus & breaks</h3>
            <div className={cx("form-row")}>
              <label className={cx("", true)}>
                Focus minutes
                <input
                  type="number"
                  required
                  min={1}
                  max={180}
                  value={draft.focusMinutes}
                  onChange={(e) => field("focusMinutes", +e.target.value)}
                  className={cx("", true)}
                />
              </label>
              <label className={cx("", true)}>
                Short break minutes
                <input
                  type="number"
                  required
                  min={1}
                  max={60}
                  value={draft.shortBreakMinutes}
                  onChange={(e) => field("shortBreakMinutes", +e.target.value)}
                  className={cx("", true)}
                />
              </label>
              <label className={cx("", true)}>
                Long break minutes
                <input
                  type="number"
                  required
                  min={1}
                  max={60}
                  value={draft.longBreakMinutes}
                  onChange={(e) => field("longBreakMinutes", +e.target.value)}
                  className={cx("", true)}
                />
              </label>
            </div>
          </section>
          <section className={cx("section")}>
            <h3>Sound</h3>
            <label className={cx("check-label", true)}>
              <input
                type="checkbox"
                checked={draft.sound}
                onChange={(e) => field("sound", e.target.checked)}
                className={cx("", true)}
              />
              Timer sound
            </label>
            <label className={cx("", true)}>
              Completion sound
              <span className={cx("select-wrap")}>
                <select
                  value={draft.timerSound ?? "classic"}
                  disabled={!draft.sound}
                  onChange={(e) => field("timerSound", e.target.value)}
                  className={cx("", true)}
                >
                  {timerSounds.map((sound) => (
                    <option key={sound.value} value={sound.value}>
                      {sound.label}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className={cx("", true)}>
              Sound volume
              <input
                className={cx("", true)}
                type="range"
                aria-label="Sound volume"
                min={0}
                max={100}
                step={1}
                value={draft.soundVolume ?? 75}
                disabled={!draft.sound}
                onChange={(e) => field("soundVolume", +e.target.value)}
              />
              <span aria-hidden="true">{draft.soundVolume ?? 75}%</span>
            </label>
            <button
              type="button"
              disabled={!draft.sound}
              onClick={() => {
                if (playing) {
                  stopPreview.current?.();
                  if (previewTimeout.current)
                    clearTimeout(previewTimeout.current);
                  setPlaying(false);
                } else void previewSound();
              }}
              className={cx("", true)}
            >
              {playing ? "Stop preview" : "Preview sound"}
            </button>
            {previewError && <p role="alert">{previewError}</p>}
            <p>
              Play a completion sound while the app is open, independently of
              notification settings.
            </p>
          </section>
        </fieldset>
        <NotificationSettings
          owner={owner}
          state={state}
          draft={combined.notifications}
          setDraft={setNotifications}
          execute={execute}
          reload={reload}
          disabled={
            !ready ||
            disabled ||
            recovering ||
            command.busy ||
            command.uncertain
          }
          onPendingChange={setDevicePending}
        />
        {loadError && <p role="alert">{loadError}</p>}
        {recoveryError && <p role="alert">{recoveryError}</p>}
        {notice && <p role="status">{notice}</p>}
        {command.error && (
          <p role="alert" className={cx("error")}>
            {command.error}
          </p>
        )}
        {command.conflict && (
          <div className={cx("notice")}>
            <p>
              Your input is kept. Review the latest settings before applying it
              again.
            </p>
            <button
              type="button"
              disabled={recovering || disabled}
              onClick={() =>
                void actions.run("reapply", () => recoverDraft(true))
              }
              className={cx("", true)}
              data-pending-control="true"
              aria-busy={Boolean(actions.isPending("reapply"))}
            >
              <span data-button-content="true">
                {actions.isPending("reapply") && <LoadingIndicator />}Reapply
                draft to latest settings
              </span>
              <span aria-hidden="true" data-button-reserve="true">
                Reapply draft to latest settings
              </span>
            </button>
            <button
              type="button"
              disabled={recovering || disabled}
              onClick={() =>
                void actions.run("discard", () => recoverDraft(false))
              }
              className={cx("", true)}
              data-pending-control="true"
              aria-busy={Boolean(actions.isPending("discard"))}
            >
              <span data-button-content="true">
                {actions.isPending("discard") && <LoadingIndicator />}Discard
                draft and reload settings
              </span>
              <span aria-hidden="true" data-button-reserve="true">
                Discard draft and reload settings
              </span>
            </button>
          </div>
        )}
        <button
          className={cx("primary", true)}
          disabled={
            !ready ||
            disabled ||
            devicePending ||
            recovering ||
            command.busy ||
            command.conflict ||
            !ready
          }
          data-pending-control="true"
          aria-busy={Boolean(command.busy)}
        >
          <span data-button-content="true">
            {command.busy ? (
              <>
                <LoadingIndicator />
                Saving…
              </>
            ) : command.uncertain ? (
              "Retry save"
            ) : (
              "Save changes"
            )}
          </span>
          <span aria-hidden="true" data-button-reserve="true">
            Saving…
          </span>
          <span aria-hidden="true" data-button-reserve="true">
            Retry save
          </span>
          <span aria-hidden="true" data-button-reserve="true">
            Save changes
          </span>
        </button>
      </ValidatedForm>
    </ContentCard>
  );
}
