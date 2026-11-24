import styles from "./loadingIndicator.module.css";
import a11y from "../../styles/uiPrimitives.module.css";
export function LoadingIndicator({
  size = 16,
  label,
}: {
  size?: number;
  label?: string;
}) {
  const glyph = (
    <svg
      className={styles.indicator}
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="42 15"
      />
    </svg>
  );
  return label ? (
    <span role="status">
      {glyph}
      <span className={a11y["sr-only"]}>{label}</span>
    </span>
  ) : (
    glyph
  );
}
