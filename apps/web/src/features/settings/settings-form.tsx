"use client";
import { useAccountDraft } from "../../lib/use-account-draft";
import type { Settings } from "../../lib/model";
import type { Execute } from "../../app/providers";
import { useCommand } from "../../lib/use-command";
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
    <section className="settings-card">
      <p className="eyebrow">MAKE IT YOURS</p>
      <h2>Workspace settings</h2>
      <p className="muted">Your preferences follow you across browsers.</p>
      <form
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
        <fieldset disabled={disabled || command.busy || command.uncertain}>
          <label>
            Appearance
            <select
              value={draft.appearance}
              onChange={(e) => field("appearance", e.target.value)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>
            Timezone
            <input
              required
              list="timezones"
              value={draft.timezone}
              onChange={(e) => field("timezone", e.target.value)}
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
          <p className="muted">
            Changing timezone can finalize days that have ended. Existing
            history stays unchanged.
          </p>
          <div className="form-row">
            <label>
              Focus minutes
              <input
                type="number"
                required
                min={1}
                max={180}
                value={draft.focusMinutes}
                onChange={(e) => field("focusMinutes", +e.target.value)}
              />
            </label>
            <label>
              Short break minutes
              <input
                type="number"
                required
                min={1}
                max={60}
                value={draft.shortBreakMinutes}
                onChange={(e) => field("shortBreakMinutes", +e.target.value)}
              />
            </label>
            <label>
              Long break minutes
              <input
                type="number"
                required
                min={1}
                max={60}
                value={draft.longBreakMinutes}
                onChange={(e) => field("longBreakMinutes", +e.target.value)}
              />
            </label>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={draft.sound}
              onChange={(e) => field("sound", e.target.checked)}
            />
            Timer sound
          </label>
        </fieldset>
        {command.error && (
          <p role="alert" className="error">
            {command.error}
          </p>
        )}
        {command.conflict && (
          <div className="notice">
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
            >
              Reapply draft to latest settings
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(settings);
                command.dismissError();
              }}
            >
              Discard draft and reload settings
            </button>
          </div>
        )}
        <button
          className="primary"
          disabled={disabled || command.busy || !ready}
        >
          {command.busy
            ? "Saving…"
            : command.uncertain
              ? "Retry save"
              : "Save settings"}
        </button>
      </form>
    </section>
  );
}
