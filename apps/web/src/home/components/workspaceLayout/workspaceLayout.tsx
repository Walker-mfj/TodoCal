"use client";
import { bindStyles } from "../../../shared/utils/classNames";
import styles from "./workspaceLayout.module.css";
const cx = bindStyles(styles);
import type { ReactNode } from "react";
export function WorkspaceLayout({
  hasPanel,
  sidebarCollapsed,
  children,
}: {
  hasPanel: boolean;
  sidebarCollapsed: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        `app-shell ${hasPanel ? "has-panel" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`,
      )}
    >
      <a className={cx("skip-link")} href="#main">
        Skip to workspace
      </a>
      {children}
    </div>
  );
}
export function WorkspaceMain({
  page,
  children,
}: {
  page: string;
  children: ReactNode;
}) {
  return (
    <main
      id="main"
      className={cx(
        `workspace ${page === "calendar" ? "calendar-workspace" : ""}`,
      )}
    >
      {children}
    </main>
  );
}
