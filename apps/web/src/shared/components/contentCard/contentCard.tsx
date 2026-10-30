import type { ReactNode } from "react";
import styles from "./contentCard.module.css";
export function ContentCard({ children }: { children: ReactNode }) {
  return (
    <section className={`settings-card ${styles["settings-card"] || ""}`}>
      {children}
    </section>
  );
}
