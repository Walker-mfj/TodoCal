"use client";
import { bindStyles } from "../../../shared/utils/classNames";
import styles from "./taskFilters.module.css";
const cx = bindStyles(styles);
import { Search } from "lucide-react";
import type { Group } from "../../../shared/api/domainTypes";
export function TaskFilters({
  search,
  setSearch,
  group,
  setGroup,
  priority,
  setPriority,
  status,
  setStatus,
  allGroups,
}: {
  search: string;
  setSearch: (value: string) => void;
  group: string;
  setGroup: (value: string) => void;
  priority: string;
  setPriority: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  allGroups: Group[];
}) {
  return (
    <div className={cx("filters")}>
      <label className={cx("search", true)}>
        <Search size={16} />
        <input
          aria-label="Search tasks"
          placeholder="Search tasks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cx("", true)}
        />
      </label>
      <span className={cx("select-wrap")}>
        <select
          aria-label="Filter group"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          className={cx("", true)}
        >
          <option value="">All groups</option>
          <option value="none">No group</option>
          {allGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </span>
      <span className={cx("select-wrap")}>
        <select
          aria-label="Filter priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className={cx("", true)}
        >
          <option value="">All priorities</option>
          {["low", "medium", "high"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </span>
      <span className={cx("select-wrap")}>
        <select
          aria-label="Filter status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={cx("", true)}
        >
          <option value="">All statuses</option>
          <option value="incomplete">To do</option>
          <option value="complete">Complete</option>
        </select>
      </span>
    </div>
  );
}
