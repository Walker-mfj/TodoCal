import type { CSSProperties } from "react";
import styles from "./skeleton.module.css";
export function Skeleton({
  width = "100%",
  height = 16,
  variant = "rect",
}: {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  variant?: "rect" | "circle";
}) {
  return (
    <span
      aria-hidden="true"
      className={styles[variant]}
      style={{ width, height }}
    />
  );
}
