import { LoaderCircle } from "lucide-react";
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
    <LoaderCircle
      className={styles.indicator}
      style={{ width: size, height: size }}
      size={size}
      aria-hidden="true"
      focusable="false"
    />
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
