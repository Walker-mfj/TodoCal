import uiStyles from "../styles/uiPrimitives.module.css";
import controlStyles from "../styles/formControls.module.css";

/** Keep semantic integration hooks alongside locally scoped presentation classes. */
export function bindStyles(styles: Record<string, string> = {}) {
  return (value: string | undefined, control = false) => {
    const names = (value || "").split(/\s+/).filter(Boolean);
    return [
      ...new Set([
        ...names,
        ...names
          .map((name) => styles?.[name] || uiStyles?.[name])
          .filter(Boolean),
        ...(control ? ["control", controlStyles?.control] : []),
      ]),
    ]
      .filter(Boolean)
      .join(" ");
  };
}
