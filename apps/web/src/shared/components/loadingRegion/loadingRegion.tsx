import type { ReactNode } from "react";
import a11y from "../../styles/uiPrimitives.module.css";
// Keep the announcement outside the busy subtree so assistive technology can announce it now.
export function LoadingRegion({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span>
      <span aria-busy="true">{children}</span>
      <span role="status" className={a11y["sr-only"]}>
        {label}
      </span>
    </span>
  );
}
