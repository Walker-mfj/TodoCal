"use client";
import { ContentCard } from "../../../../shared/components/contentCard/contentCard";
import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./groups.module.css";
const cx = bindStyles(styles);

import { useState } from "react";
import { useConfirm } from "../../../../shared/components/appDialog/appDialog";
import { ValidatedForm } from "../../../../shared/components/validatedForm/validatedForm";
import { useAccountDraft } from "../../../../shared/hooks/useAccountDraft";
import { useCommand } from "../../../../shared/hooks/useCommand";
import type { Execute } from "../../../../shared/api/apiClient";
import type { Group } from "../../../../shared/api/domainTypes";
const palette = [
  ["Blue", "#4169b1"],
  ["Orange", "#ed7d31"],
  ["Green", "#278765"],
  ["Purple", "#8056b3"],
  ["Rose", "#c84e75"],
  ["Teal", "#16838c"],
  ["Gold", "#b58a23"],
  ["Slate", "#64748b"],
];
export function Groups({
  owner,
  groups,
  execute,
  disabled,
}: {
  owner: string;
  groups: Group[];
  execute: Execute;
  disabled: boolean;
}) {
  const confirm = useConfirm();
  const [custom, setCustom] = useState(false);
  const { draft, setDraft, ready } = useAccountDraft<{
    editing: Group | null;
    name: string;
    color: string;
  }>(`focus:form:${owner}:groups`, {
    editing: null,
    name: "",
    color: "#4169b1",
  });
  const { editing, name, color } = draft;
  const setEditing = (editing: Group | null) =>
    setDraft((d) => ({ ...d, editing }));
  const setName = (name: string) => setDraft((d) => ({ ...d, name }));
  const setColor = (color: string) => setDraft((d) => ({ ...d, color }));
  const command = useCommand(execute, `focus:command:${owner}:groups`);
  const clear = () => {
    setEditing(null);
    setName("");
  };
  return (
    <ContentCard>
      <p className={cx("eyebrow")}>ROOM FOR EVERY PART OF LIFE</p>
      <h2>Groups</h2>
      <p className={cx("muted")}>
        Deleting a group keeps its tasks and their history.
      </p>
      <div className={cx("group-list")}>
        {groups.map((g) => (
          <div className={cx("group-row")} key={g.id}>
            <span className={cx("dot")} style={{ background: g.color }} />
            <strong>{g.name}</strong>
            <button
              disabled={command.busy || command.uncertain}
              onClick={() => {
                setEditing(g);
                setName(g.name);
                setColor(g.color);
                setCustom(!palette.some(([, hex]) => hex === g.color));
              }}
              className={cx("", true)}
            >
              Edit
            </button>
            <button
              className={cx("danger", true)}
              disabled={disabled || command.busy || command.uncertain}
              onClick={async () => {
                if (
                  await confirm(
                    `Delete group “${g.name}”? Tasks will be kept.`,
                    {
                      title: "Delete group?",
                      confirmLabel: "Delete group",
                      destructive: true,
                    },
                  )
                )
                  void command.run(
                    `/groups/${g.id}`,
                    "DELETE",
                    { expectedRevision: g.revision },
                    clear,
                  );
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <h3>{editing ? "Edit group" : "New group"}</h3>
      <ValidatedForm
        onSubmit={(e) => {
          e.preventDefault();
          void command.run(
            editing ? `/groups/${editing.id}` : "/groups",
            editing ? "PATCH" : "POST",
            {
              name,
              color,
              ...(editing ? { expectedRevision: editing.revision } : {}),
            },
            clear,
          );
        }}
      >
        <fieldset
          disabled={disabled || command.busy || command.uncertain}
          className={cx("", true)}
        >
          <div className={cx("form-row")}>
            <label className={cx("", true)}>
              Group name
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={cx("", true)}
              />
            </label>
            <div className={cx("group-color-field")}>
              <span className={cx("color-label")}>Color</span>
              <div
                className={cx("color-palette")}
                role="group"
                aria-label="Group color"
              >
                {palette.map(([name, hex]) => (
                  <button
                    key={hex}
                    type="button"
                    className={cx("color-swatch", true)}
                    aria-label={name}
                    title={name}
                    aria-pressed={color === hex}
                    style={
                      {
                        backgroundColor: hex,
                        "--swatch": hex,
                      } as React.CSSProperties
                    }
                    onClick={() => {
                      setColor(hex);
                      setCustom(false);
                    }}
                  />
                ))}
                <button
                  type="button"
                  aria-pressed={
                    custom || !palette.some(([, hex]) => hex === color)
                  }
                  onClick={() => setCustom(true)}
                  className={cx("", true)}
                >
                  Custom color
                </button>
              </div>
              {(custom || !palette.some(([, hex]) => hex === color)) && (
                <label className={cx("", true)}>
                  Custom color
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className={cx("", true)}
                  />
                </label>
              )}
            </div>
          </div>
        </fieldset>
        {command.error && (
          <p role="alert" className={cx("error")}>
            {command.error}
          </p>
        )}
        <button
          className={cx("primary", true)}
          disabled={disabled || command.busy || !ready}
        >
          {command.uncertain
            ? "Retry request"
            : editing
              ? "Save group"
              : "Create group"}
        </button>
        {editing && !command.uncertain && (
          <button type="button" onClick={clear} className={cx("", true)}>
            Cancel
          </button>
        )}
      </ValidatedForm>
    </ContentCard>
  );
}
