import { LoadingIndicator } from "../loadingIndicator/loadingIndicator";
import styles from "./loadingPage.module.css";
export function LoadingPage({
  label = "Opening your workspace…",
}: {
  label?: string;
}) {
  return (
    <main className={styles.page}>
      <span aria-busy="true">
        <LoadingIndicator size={32} />
      </span>
      <p role="status">{label}</p>
    </main>
  );
}
