"use client";
import { useEffect, useState } from "react";
import { sessionStore } from "../../shared/utils/sessionStorage";

export function useWorkspaceNavigation(owner: string) {
  const [page, updatePage] = useState("calendar");
  const [showFocus, setShowFocus] = useState(false);
  const navigationKey = `focus:navigation:${owner}`;
  const [navigationReady, setNavigationReady] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStore.getItem(navigationKey) || "null");
      if (
        saved &&
        ["calendar", "tasks", "progress", "groups", "settings"].includes(
          saved.page,
        )
      ) {
        updatePage(saved.page);
        setShowFocus(saved.focus === true);
      }
    } catch {
      /* Ignore obsolete navigation state. */
    }
    setNavigationReady(true);
  }, [navigationKey]);
  useEffect(() => {
    if (navigationReady)
      sessionStore.setItem(
        navigationKey,
        JSON.stringify({ page, focus: showFocus }),
      );
  }, [navigationKey, navigationReady, page, showFocus]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    try {
      setSidebarCollapsed(
        localStorage.getItem("focus:ui:sidebar-collapsed") === "true",
      );
    } catch {
      /* Storage may be disabled; navigation remains usable. */
    }
  }, []);
  const toggleSidebar = () => {
    const collapsed = !sidebarCollapsed;
    setSidebarCollapsed(collapsed);
    try {
      localStorage.setItem("focus:ui:sidebar-collapsed", String(collapsed));
    } catch {
      /* Keep the current state even if storage is unavailable. */
    }
  };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const destination = params.get("notification");
    if (destination !== "focus" && destination !== "calendar") return;
    updatePage("calendar");
    if (destination === "focus") setShowFocus(true);
    params.delete("notification");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname +
        (query ? `?${query}` : "") +
        window.location.hash,
    );
  }, []);
  return {
    page,
    updatePage,
    showFocus,
    setShowFocus,
    sidebarCollapsed,
    toggleSidebar,
  };
}
