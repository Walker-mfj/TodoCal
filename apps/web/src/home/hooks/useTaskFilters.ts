"use client";
import { useCallback, useEffect, useState } from "react";
import type { Task } from "../../shared/api/domainTypes";

export function useTaskFilters() {
  const [search, setSearch] = useState(""),
    [group, setGroup] = useState(""),
    [priority, setPriority] = useState(""),
    [status, setStatus] = useState(""),
    [view, setView] = useState("all"),
    [cursor, setCursor] = useState("");
  const params = new URLSearchParams({
    limit: "100",
    view,
    ...(search ? { search } : {}),
    ...(group ? { groupId: group } : {}),
    ...(priority ? { priority } : {}),
    ...(status ? { status } : {}),
    ...(cursor ? { cursor } : {}),
  });
  const filter = useCallback(
    (t: Task) =>
      (!search ||
        `${t.title} ${t.description}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!group || (group === "none" ? !t.groupId : t.groupId === group)) &&
      (!priority || priority === t.priority) &&
      (!status || status === t.status),
    [search, group, priority, status],
  );
  useEffect(() => {
    setCursor("");
  }, [search, group, priority, status, view]);
  return {
    search,
    setSearch,
    group,
    setGroup,
    priority,
    setPriority,
    status,
    setStatus,
    view,
    setView,
    cursor,
    setCursor,
    params,
    filter,
  };
}
