"use client";
import { ContentCard } from "../../../../shared/components/contentCard/contentCard";
import { bindStyles } from "../../../../shared/utils/classNames";
const cx = bindStyles();

import { ValidatedForm } from "../../../../shared/components/validatedForm/validatedForm";
import { useAccountDraft } from "../../../../shared/hooks/useAccountDraft";
import type { Settings } from "../../../../shared/api/domainTypes";
import type { Execute } from "../../../../shared/api/apiClient";
import { useCommand } from "../../../../shared/hooks/useCommand";
export function SettingsForm({
  owner,
  settings,
  execute,
  refresh,
  disabled,
}: {
  owner: string;
  settings: Settings;
  execute: Execute;
  refresh: () => unknown;
  disabled: boolean;
}) {
  const { draft, setDraft, ready } = useAccountDraft(
    `focus:form:${owner}:settings`,
    settings,
  );
  const command = useCommand(execute, `focus:command:${owner}:settings`);
  const field = (key: keyof Settings, value: string | number | boolean) =>
    setDraft((d) => ({ ...d, [key]: value }));
  return (
    <ContentCard>
      <p className={cx("eyebrow")}>MAKE IT YOURS</p>
      <h2>Workspace settings</h2>
      <p className={cx("muted")}>
        Your preferences follow you across browsers.
      </p>
      <ValidatedForm
        onSubmit={(e) => {
          e.preventDefault();
          const { revision, ...body } = draft;
          void command.run(
            "/settings",
            "PATCH",
            { ...body, expectedRevision: revision },
            () => {
              setDraft({ ...draft, revision: revision + 1 });
              void refresh();
            },
          );
        }}
      >
        <fieldset
          disabled={disabled || command.busy || command.uncertain}
          className={cx("", true)}
        >
          <label className={cx("", true)}>
            Appearance
            <select
              value={draft.appearance}
              onChange={(e) => field("appearance", e.target.value)}
              className={cx("", true)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className={cx("", true)}>
            Timezone
            <input
              required
              list="timezones"
              value={draft.timezone}
              onChange={(e) => field("timezone", e.target.value)}
              className={cx("", true)}
            />
            <datalist id="timezones">
              {[
                "Asia/Tokyo",
                "Asia/Ho_Chi_Minh",
                "UTC",
                "Europe/London",
                "America/New_York",
                "America/Los_Angeles",
                "Australia/Sydney",
              ].map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </label>
          <p className={cx("muted")}>
            Changing timezone can finalize days that have ended. Existing
            history stays unchanged.
          </p>
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
          <label className={cx("check-label", true)}>
            <input
              type="checkbox"
              checked={draft.sound}
              onChange={(e) => field("sound", e.target.checked)}
              className={cx("", true)}
            />
            Timer sound
          </label>
          <p>
            Play a completion sound while the app is open, independently of
            notification settings.
          </p>
        </fieldset>
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
              onClick={() => {
                setDraft({ ...draft, revision: settings.revision });
                command.dismissError();
              }}
              className={cx("", true)}
            >
              Reapply draft to latest settings
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(settings);
                command.dismissError();
              }}
              className={cx("", true)}
            >
              Discard draft and reload settings
            </button>
          </div>
        )}
        <button
          className={cx("primary", true)}
          disabled={disabled || command.busy || !ready}
        >
          {command.busy
            ? "Saving…"
            : command.uncertain
              ? "Retry save"
              : "Save settings"}
        </button>
      </ValidatedForm>
    </ContentCard>
  );
}
