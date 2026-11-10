"use client";
import { bindStyles } from "../../../shared/utils/classNames";
import styles from "./workspaceSidebar.module.css";
const cx = bindStyles(styles);
import Image from "next/image";
import calendarCheckmark from "../../../../assets/brand/calendarCheckmark.png";
import {
  CalendarDays,
  ListTodo,
  ChartNoAxesColumn,
  Settings2,
  Folder,
  Plus,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Timer,
} from "lucide-react";
import { AccountMenu } from "../../../features/auth";
import type { Group } from "../../../shared/api/domainTypes";
export function WorkspaceSidebar({
  page,
  sidebarCollapsed,
  toggleSidebar,
  allGroups,
  onNew,
  onPage,
  onGroup,
  email,
  connected,
  focusHidden,
  onToggleFocus,
  onSignOut,
}: {
  page: string;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  allGroups: Group[];
  onNew: () => void;
  onPage: (page: string) => void;
  onGroup: (id: string) => void;
  email: string;
  connected: boolean;
  focusHidden: boolean;
  onToggleFocus: () => void;
  onSignOut: () => void;
}) {
  const navigation = [
    ["calendar", "Calendar", CalendarDays],
    ["tasks", "Tasks", ListTodo],
    ["progress", "Progress", ChartNoAxesColumn],
    ["groups", "Groups", Folder],
    ["settings", "Settings", Settings2],
  ] as const;
  return (
    <aside className={cx("sidebar")}>
      <div className={cx("sidebar-header")}>
        <div className={cx("brand sidebar-brand")}>
          <span className={cx("brand-mark")} aria-hidden="true">
            <Image src={calendarCheckmark} alt="" width={36} height={36} />
          </span>
          <span className={cx("sidebar-brand-name")}>
            Todo<span className={cx("sidebar-brand-accent")}>Cal</span>
          </span>
        </div>
        <button
          className={cx("sidebar-toggle", true)}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!sidebarCollapsed}
          onClick={toggleSidebar}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <PanelLeftClose size={18} />
          )}
        </button>
      </div>
      <button
        className={cx("primary new-task", true)}
        aria-label="New task"
        title="New task"
        onClick={() => onNew()}
      >
        <Plus size={17} />
        <span className={cx("nav-label")}>New task</span>
      </button>
      <nav aria-label="Main navigation">
        {navigation.map(([key, label, Icon]) => (
          <button
            key={key}
            aria-label={label}
            title={label}
            aria-current={page === key ? "page" : undefined}
            className={cx(page === key ? "active" : "", true)}
            onClick={() => onPage(key)}
          >
            <Icon size={18} />
            <span className={cx("nav-label")}>{label}</span>
          </button>
        ))}
      </nav>
      <div className={cx("sidebar-groups")}>
        <p className={cx("eyebrow")}>YOUR GROUPS</p>
        {allGroups.length ? (
          allGroups.map((g) => (
            <button
              key={g.id}
              onClick={() => {
                onGroup(g.id);
              }}
              className={cx("", true)}
            >
              <i className={cx("dot")} style={{ background: g.color }} />
              {g.name}
            </button>
          ))
        ) : (
          <p className={cx("muted")}>A little structure helps.</p>
        )}
        <button
          className={cx("text-button", true)}
          onClick={() => onPage("groups")}
        >
          <Plus size={14} />
          Manage groups
        </button>
      </div>
      <AccountMenu email={email} connected={connected}>
        <div className={cx("focus-preference")}>
          <span className={cx("focus-preference-label")}>
            <Timer size={16} /> Focus widget
          </span>
          <button
            className={cx("focus-switch", true)}
            role="switch"
            aria-label="Show floating focus timer"
            aria-checked={!focusHidden}
            title="Show floating focus timer"
            onClick={() => onToggleFocus()}
          >
            <span />
          </button>
        </div>
        <button
          className={cx("account-signout", true)}
          aria-label="Sign out"
          title="Sign out"
          disabled={!connected}
          onClick={onSignOut}
        >
          <LogOut size={16} />
          <span>Sign out</span>
        </button>
      </AccountMenu>
    </aside>
  );
}
