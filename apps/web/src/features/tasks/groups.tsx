"use client";
import { useConfirm } from "../../components/app-dialog";
import { ValidatedForm } from "../../components/validated-form";
import { useAccountDraft } from "../../lib/use-account-draft";
import { useCommand } from "../../lib/use-command";
import type { Execute } from "../../app/providers";
import type { Group } from "../../lib/model";
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
    <section className="settings-card">
      <p className="eyebrow">ROOM FOR EVERY PART OF LIFE</p>
      <h2>Groups</h2>
      <p className="muted">
        Deleting a group keeps its tasks and their history.
      </p>
      <div className="group-list">
        {groups.map((g) => (
          <div className="group-row" key={g.id}>
            <span className="dot" style={{ background: g.color }} />
            <strong>{g.name}</strong>
            <button
              disabled={command.busy || command.uncertain}
              onClick={() => {
                setEditing(g);
                setName(g.name);
                setColor(g.color);
              }}
            >
              Edit
            </button>
            <button
              className="danger"
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
        <fieldset disabled={disabled || command.busy || command.uncertain}>
          <div className="form-row">
            <label>
              Group name
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Color
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
          </div>
        </fieldset>
        {command.error && (
          <p role="alert" className="error">
            {command.error}
          </p>
        )}
        <button
          className="primary"
          disabled={disabled || command.busy || !ready}
        >
          {command.uncertain
            ? "Retry request"
            : editing
              ? "Save group"
              : "Create group"}
        </button>
        {editing && !command.uncertain && (
          <button type="button" onClick={clear}>
            Cancel
          </button>
        )}
      </ValidatedForm>
    </section>
  );
}
