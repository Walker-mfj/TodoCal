"use client";
import { bindStyles } from "../../../shared/utils/classNames";
import styles from "./homePage.module.css";
const cx = bindStyles(styles);

import { SidebarPanel } from "../../../shared/components/sidebarPanel/sidebarPanel";
import { AccountMenu } from "../../../features/auth/components/accountMenu/accountMenu";
import {
  ToastProvider,
  ToastNotice,
} from "../../../shared/components/toast/toast";
import type { CalendarDraft } from "../../../features/calendar/utils/draftPreview";
import { useConfirm } from "../../../shared/components/appDialog/appDialog";
import { sessionStore } from "../../../shared/utils/sessionStorage";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import calendarCheckmark from "../../../../assets/brand/calendarCheckmark.png";
import { DateTime } from "luxon";
import {
  CalendarDays,
  ListTodo,
  ChartNoAxesColumn,
  Settings2,
  Folder,
  Plus,
  LogOut,
  Search,
  ArrowUpRight,
  PanelLeftClose,
  PanelLeftOpen,
  Timer,
} from "lucide-react";
import {
  AnalyticsSummary,
  DayFocusDetails,
  type PeriodReport,
  type AnalyticsDay,
} from "../../../features/analytics/components/analyticsSummary/analyticsSummary";
import { completionRatio } from "../../../shared/utils/progress";
import { useFocus } from "../../../features/focus/hooks/useFocus";
import { FloatingFocus } from "../../../features/focus/components/floatingFocus/floatingFocus";
import { TimerPanel } from "../../../features/focus/components/timerPanel/timerPanel";
import { useSession } from "../../../features/auth/components/sessionProvider/sessionProvider";
import { useOwnedQuery } from "../../../features/auth/hooks/useOwnedQuery";
import { AuthScreen } from "../../../features/auth/components/authScreen/authScreen";
import { TaskEditor } from "../../../features/tasks/components/taskEditor/taskEditor";
import {
  RecoveryToast,
  type RecoveryItem,
} from "../../../features/tasks/components/recoveryToast/recoveryToast";
import { TaskDetail } from "../../../features/tasks/components/taskDetail/taskDetail";
import { TaskRow } from "../../../features/tasks/components/taskRow/taskRow";
import { Groups } from "../../../features/tasks/components/groups/groups";
import { NotificationSettings } from "../../../features/notifications/components/notificationSettings";
import { SettingsForm } from "../../../features/settings/components/settingsForm/settingsForm";
import {
  DailyProgress,
  DayStrip,
  ProgressLegend,
} from "../../../features/calendar/components/progress/progress";
import { Ring } from "../../../shared/components/progressRing/progressRing";
import { dateLabel, today } from "../../../shared/utils/dateUtils";
import { type Draft } from "../../../features/tasks/types/taskTypes";
import {
  type Task,
  type Group,
  type Day,
  type CalendarRange,
} from "../../../shared/api/domainTypes";
import { errorMessage } from "../../../shared/api/apiClient";
import { useSchedule } from "../../../features/calendar/hooks/useSchedule";
import { ScheduleScopeDialog } from "../../../features/calendar/components/scheduleScopeDialog/scheduleScopeDialog";
import { UndoToast } from "../../../features/calendar/components/undoToast/undoToast";
import { useCommand } from "../../../shared/hooks/useCommand";
const Calendar = dynamic(
  () => import("../../../features/calendar/components/calendar/calendar"),
  {
    ssr: false,
    loading: () => <div className={cx("loading")}>Loading calendar…</div>,
  },
);
type Panel =
  | { type: "new"; seed?: Partial<Draft> }
  | {
      type: "edit" | "detail";
      task: Task;
      historical?: boolean;
      seed?: Partial<Draft>;
    }
  | { type: "day"; date: string }
  | null;
export default function HomePage() {
  const { session, loading } = useSession();
  if (loading || !session) return <AuthScreen />;
  return (
    <ToastProvider key={session.user.id}>
      <AccountWorkspace />
    </ToastProvider>
  );
}
function AccountWorkspace() {
  const confirm = useConfirm();
  const [draftPreview, setDraftPreview] = useState<CalendarDraft | null>(null);
  const [editorState, setEditorState] = useState({
    dirty: false,
    blocked: false,
  });
  const { session, connected, execute, read, refresh, logout } = useSession();
  const account = session!;
  const focus = useFocus();
  const [showFocus, setShowFocus] = useState(false);
  const [focusHidden, setFocusHidden] = useState(false);
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const date = today(account.settings.timezone);
  const [page, updatePage] = useState("calendar"),
    [panel, setPanel] = useState<Panel>(null),
    [search, setSearch] = useState(""),
    [group, setGroup] = useState(""),
    [priority, setPriority] = useState(""),
    [status, setStatus] = useState(""),
    [view, setView] = useState("all"),
    [cursor, setCursor] = useState(""),
    [message, setMessage] = useState("");
  const navigationKey = `focus:navigation:${account.user.id}`;
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
  const [recovery, setRecovery] = useState<RecoveryItem | null>(null);
  const [saveNotice, setSaveNotice] = useState("");
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
  const [unscheduledOpen, setUnscheduledOpen] = useState(false);
  const [range, setRange] = useState(() => ({
    from: DateTime.fromISO(date).startOf("week").toISODate()!,
    to: DateTime.fromISO(date).startOf("week").plus({ weeks: 1 }).toISODate()!,
  }));
  const [period, setPeriod] = useState<"week" | "month">("week"),
    [periodDate, setPeriodDate] = useState(date);
  const [selectedReportDate, setSelectedReportDate] = useState<string>();
  const periodStart = DateTime.fromISO(periodDate).startOf(period);
  const reportFrom = periodStart.toISODate()!,
    reportTo = periodStart
      .plus(period === "week" ? { weeks: 1 } : { months: 1 })
      .toISODate()!;
  const report = useOwnedQuery<PeriodReport>(
    "period",
    `/reports/period?period=${period}&date=${periodDate}`,
    page === "progress",
  );
  useEffect(() => {
    if (
      selectedReportDate &&
      (selectedReportDate < reportFrom || selectedReportDate >= reportTo)
    )
      setSelectedReportDate(reportFrom);
    if (
      page === "progress" &&
      panel?.type === "day" &&
      (panel.date < reportFrom || panel.date >= reportTo)
    )
      setPanel({ type: "day", date: reportFrom });
  }, [page, reportFrom, reportTo, panel, selectedReportDate]);
  const calendar = useOwnedQuery<CalendarRange>(
    "calendar",
    `/calendar?from=${page === "progress" ? reportFrom : range.from}&to=${page === "progress" ? reportTo : range.to}`,
  );
  const groups = useOwnedQuery<{ items: Group[] }>("groups", "/groups");
  const todayReport = useOwnedQuery<Day>("today", `/reports/days/${date}`);
  const day = useOwnedQuery<AnalyticsDay>(
    "day",
    `/reports/days/${panel?.type === "day" ? panel.date : date}`,
    panel?.type === "day",
  );
  const params = new URLSearchParams({
    limit: "100",
    view,
    ...(search ? { search } : {}),
    ...(group ? { groupId: group } : {}),
    ...(priority ? { priority } : {}),
    ...(status ? { status } : {}),
    ...(cursor ? { cursor } : {}),
  });
  const tasks = useOwnedQuery<{ items: Task[]; nextCursor: string | null }>(
    "tasks",
    `/tasks?${params}`,
    page === "tasks",
  );
  const unscheduled = useOwnedQuery<{
    items: Task[];
    nextCursor: string | null;
  }>("unscheduled", "/tasks?view=unscheduled&limit=20");
  const command = useCommand(execute);
  const scheduling = useSchedule();
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
  useEffect(() => {
    if (sessionStore.getItem(`focus:draft:${account.user.id}:new`))
      setPanel({ type: "new" });
  }, [account.user.id]);
  const setRangeStable = useCallback(
    (from: string, to: string) =>
      setRange((r) => (r.from === from && r.to === to ? r : { from, to })),
    [],
  );
  const open = async (next: Panel) => {
    if (
      (panel?.type === "edit" || panel?.type === "new") &&
      editorState.dirty
    ) {
      if (
        !(await confirm("Unsaved changes will be discarded.", {
          title: "Discard unsaved changes?",
          confirmLabel: "Discard changes",
          destructive: true,
          cancelLabel: "Keep editing",
        }))
      )
        return;
    }
    if (panel?.type === "new" || panel?.type === "edit") {
      sessionStore.removeItem(
        `focus:draft:${account.user.id}:${panel.type === "edit" ? panel.task.id : "new"}`,
      );
      setEditorState({ dirty: false, blocked: false });
    }
    if (next?.type === "day") setSelectedReportDate(next.date);
    setDraftPreview(null);
    setPanel(next);
    setSaveNotice("");
    setMessage("");
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
  const setPage = (next: string) => {
    if (next === page) return;
    // Drafts remain recoverable, but editors belong to the page where they opened.
    setPanel(null);
    setDraftPreview(null);
    setEditorState({ dirty: false, blocked: false });
    updatePage(next);
  };
  const complete = async (task: Task) => {
    void command.run(
      `/tasks/${task.id}/completion`,
      "POST",
      {
        complete: task.status !== "complete",
        expectedRevision: task.revision,
      },
      () => setPanel(null),
    );
  };
  const openCurrent = async (task: Task) => {
    try {
      const fresh = await read<Task>(`/tasks/${task.id}`);
      open({ type: "detail", task: fresh });
    } catch (e) {
      setMessage(errorMessage(e));
    }
  };
  const restoredDrafts =
    typeof window === "undefined"
      ? []
      : sessionStore
          .keys()
          .filter(
            (k) =>
              k.startsWith(`focus:draft:${account.user.id}:`) &&
              !k.endsWith(":new"),
          );
  const navigation = [
    ["calendar", "Calendar", CalendarDays],
    ["tasks", "Tasks", ListTodo],
    ["progress", "Progress", ChartNoAxesColumn],
    ["groups", "Groups", Folder],
    ["settings", "Settings", Settings2],
  ] as const;
  const allGroups = groups.data?.items || [];
  return (
    <div
      className={cx(
        `app-shell ${panel ? "has-panel" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`,
      )}
    >
      <a className={cx("skip-link")} href="#main">
        Skip to workspace
      </a>
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
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
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
          onClick={() => open({ type: "new" })}
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
              onClick={() => setPage(key)}
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
                  setGroup(g.id);
                  setPage("tasks");
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
            onClick={() => setPage("groups")}
          >
            <Plus size={14} />
            Manage groups
          </button>
        </div>
        <AccountMenu email={account.user.email} connected={connected}>
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
              onClick={() => setFocusHidden((hidden) => !hidden)}
            >
              <span />
            </button>
          </div>
          <button
            className={cx("account-signout", true)}
            aria-label="Sign out"
            title="Sign out"
            disabled={!connected}
            onClick={async () => {
              if (
                (editorState.dirty || restoredDrafts.length > 0) &&
                !(await confirm("Sign out and discard your saved drafts?", {
                  title: "Sign out?",
                  confirmLabel: "Sign out",
                  destructive: true,
                }))
              )
                return;
              void logout().catch((e) => setMessage(errorMessage(e)));
            }}
          >
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </AccountMenu>
      </aside>
      <main
        id="main"
        className={cx(
          `workspace ${page === "calendar" ? "calendar-workspace" : ""}`,
        )}
      >
        {recovery && (
          <RecoveryToast
            key={`${recovery.kind}:${recovery.id}:${recovery.revision}`}
            item={recovery}
            execute={execute}
            connected={connected}
            onRestored={() => {
              setRecovery(null);
              setSaveNotice("Restored · Analytics updated");
            }}
            onDismiss={() => setRecovery(null)}
          />
        )}
        {scheduling.busy && (
          <ToastNotice duration={0}>Saving calendar change…</ToastNotice>
        )}
        {scheduling.error && (
          <ToastNotice tone="error" resetKey={scheduling.error}>
            {scheduling.error}
            {scheduling.pending ? (
              <button
                disabled={!connected || scheduling.busy}
                onClick={scheduling.retry}
                className={cx("", true)}
              >
                Retry calendar change
              </button>
            ) : (
              <button onClick={scheduling.dismiss} className={cx("", true)}>
                Dismiss
              </button>
            )}
          </ToastNotice>
        )}
        {scheduling.toast && (
          <UndoToast
            {...scheduling.toast}
            onUndo={scheduling.undo}
            onExpire={scheduling.expire}
            disabled={!connected || scheduling.blocked}
          />
        )}

        <header className={cx("workspace-heading")}>
          <div>
            <p className={cx("eyebrow")}>
              {dateLabel(date, "EEEE, MMMM d").toUpperCase()} ·{" "}
              {account.settings.timezone}
            </p>
            <h1>
              {page === "calendar"
                ? "A week with room to focus."
                : page === "tasks"
                  ? "One thing at a time."
                  : page === "progress"
                    ? "See how far you’ve come."
                    : page === "groups"
                      ? "A place for every plan."
                      : "Make yourself at home."}
            </h1>
            <p className={cx("muted")}>
              {page === "calendar"
                ? "A clear plan. A little breathing room."
                : page === "progress"
                  ? "Small steps add up. Explore each day of your week or month."
                  : "Your plans, at your own pace."}
            </p>
          </div>
          <span className={cx("workspace-label")}>TODOCAL</span>
        </header>
        {!connected && (
          <ToastNotice tone="warning" duration={0}>
            You’re disconnected. Saved data may be out of date; changes are
            disabled.
            <button onClick={() => void refresh()} className={cx("", true)}>
              Reconnect
            </button>
          </ToastNotice>
        )}
        {scheduling.choice && (
          <ScheduleScopeDialog
            busy={scheduling.choosing}
            error={scheduling.error}
            allAvailable={
              !!scheduling.choice.task.scheduledDate &&
              !!scheduling.choice.value.scheduledDate
            }
            onCancel={scheduling.cancelChoice}
            onChoose={scheduling.chooseScope}
          />
        )}
        <FloatingFocus
          hidden={focusHidden}
          focus={focus}
          onOpen={() => setShowFocus(true)}
        />
        {focus.command.error && (
          <ToastNotice tone="error" resetKey={focus.command.error}>
            {focus.command.error}
          </ToastNotice>
        )}
        {focus.command.uncertain && (
          <ToastNotice tone="warning" duration={0}>
            A timer action is unconfirmed.{" "}
            <button
              disabled={!connected || focus.command.busy}
              onClick={focus.retry}
              className={cx("", true)}
            >
              Retry timer action
            </button>
          </ToastNotice>
        )}
        {showFocus && (
          <TimerPanel
            focus={focus}
            task={focusTask}
            settings={account.settings}
            onClose={() => setShowFocus(false)}
            onFree={() => setFocusTask(null)}
          />
        )}
        {saveNotice && (
          <ToastNotice
            tone="success"
            resetKey={saveNotice}
            onDismiss={() => setSaveNotice("")}
          >
            {saveNotice}
          </ToastNotice>
        )}
        {(message || command.error) && (
          <ToastNotice
            tone={
              !command.error && message.startsWith("Confirm the pending save")
                ? "warning"
                : "error"
            }
            duration={command.uncertain ? 0 : undefined}
            resetKey={message || command.error}
            onDismiss={() => {
              setMessage("");
              command.dismissError();
            }}
          >
            {message || command.error}
            {command.uncertain && (
              <button
                disabled={!connected || command.busy}
                onClick={() =>
                  void command.run("", "", null, () => setPanel(null))
                }
                className={cx("", true)}
              >
                Retry request
              </button>
            )}
          </ToastNotice>
        )}
        {restoredDrafts.length > 0 && !panel && (
          <ToastNotice duration={0}>
            You have a saved task draft.
            <button
              onClick={() => {
                const id = restoredDrafts[0].split(":").pop();
                void read<Task>(`/tasks/${id}`)
                  .then((task) => open({ type: "edit", task }))
                  .catch((e) => setMessage(errorMessage(e)));
              }}
              className={cx("", true)}
            >
              Resume draft
            </button>
            <button
              onClick={async () => {
                if (
                  await confirm("Discard saved task drafts?", {
                    title: "Discard drafts?",
                    confirmLabel: "Discard drafts",
                    destructive: true,
                  })
                ) {
                  restoredDrafts.forEach((k) => sessionStore.removeItem(k));
                  setSaveNotice("Drafts discarded.");
                }
              }}
              className={cx("", true)}
            >
              Discard
            </button>
          </ToastNotice>
        )}
        {(page === "calendar" || page === "tasks") && (
          <>
            <DailyProgress
              day={todayReport.data}
              onOpen={(date) => open({ type: "day", date })}
            />
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
            </div>
          </>
        )}
        {page === "calendar" && (
          <>
            <div className={cx("calendar-card")}>
              {calendar.error ? (
                <p className={cx("error")} role="alert">
                  {errorMessage(calendar.error)}
                  <button
                    onClick={() => void calendar.refetch()}
                    className={cx("", true)}
                  >
                    Retry calendar
                  </button>
                </p>
              ) : null}
              <Calendar
                focus={focus}
                defaultFocusMinutes={account.settings.focusMinutes}
                onOpenFocus={() => setShowFocus(true)}
                draftDisabled={editorState.blocked}
                onDay={(date) => open({ type: "day", date })}
                draftPreview={
                  (panel?.type === "new" && !draftPreview?.taskId) ||
                  (panel?.type === "edit" &&
                    panel.task.id === draftPreview?.taskId)
                    ? draftPreview
                    : null
                }
                days={calendar.data?.days || []}
                groups={allGroups}
                today={date}
                onRange={setRangeStable}
                onTask={(task, historical) =>
                  open({ type: "detail", task, historical })
                }
                onCreate={(seed) => {
                  if (panel?.type === "new" || panel?.type === "edit") {
                    if (editorState.blocked) {
                      setMessage(
                        "Confirm the pending save before changing its schedule.",
                      );
                      return;
                    }
                    setPanel({ ...panel, seed });
                  } else void open({ type: "new", seed });
                }}
                filter={filter}
                disabled={
                  !connected ||
                  !!calendar.error ||
                  calendar.isPending ||
                  scheduling.blocked
                }
                onSchedule={scheduling.schedule}
                onScheduleError={scheduling.reportError}
              />
              <ProgressLegend />
            </div>
            {!!calendar.data?.warnings.length && (
              <ToastNotice tone="warning">
                Some repeating tasks fall in a daylight-saving time gap and were
                skipped: {calendar.data.warnings.map((w) => w.date).join(", ")}.
              </ToastNotice>
            )}
            <details
              className={cx("unscheduled-section")}
              open={unscheduledOpen}
              onToggle={(event) => setUnscheduledOpen(event.currentTarget.open)}
            >
              <summary>
                Without a date{" "}
                <span>{unscheduled.data?.items.length || 0}</span>
              </summary>
              <div className={cx("unscheduled-content")}>
                <div className={cx("section-title")}>
                  <h2>Without a date</h2>
                  <button
                    className={cx("text-button", true)}
                    onClick={() => {
                      setView("unscheduled");
                      setPage("tasks");
                    }}
                  >
                    View all <ArrowUpRight size={14} />
                  </button>
                </div>
                <p className={cx("muted")}>
                  Keep an idea here until you’re ready to make room.
                </p>
                {unscheduled.error ? (
                  <p className={cx("error")}>
                    {errorMessage(unscheduled.error)}
                  </p>
                ) : unscheduled.data?.items.length ? (
                  unscheduled.data.items
                    .filter(filter)
                    .map((t) => (
                      <TaskRow
                        draggable
                        key={t.id}
                        task={t}
                        groups={allGroups}
                        disabled={
                          !connected ||
                          command.busy ||
                          command.uncertain ||
                          scheduling.blocked
                        }
                        onComplete={complete}
                        onOpen={() => open({ type: "detail", task: t })}
                      />
                    ))
                ) : (
                  <button
                    className={cx("empty-add", true)}
                    onClick={() => open({ type: "new" })}
                  >
                    + Capture a task, no date needed
                  </button>
                )}
              </div>
            </details>
          </>
        )}
        {page === "tasks" && (
          <section className={cx("task-list-card")}>
            <div className={cx("list-heading")}>
              <h2>Your tasks</h2>
              <select
                aria-label="Task view"
                value={view}
                onChange={(e) => setView(e.target.value)}
                className={cx("", true)}
              >
                {[
                  ["all", "All tasks"],
                  ["today", "Today"],
                  ["upcoming", "Upcoming"],
                  ["overdue", "Overdue"],
                  ["unscheduled", "Unscheduled"],
                  ["previously-unfinished", "Previously unfinished"],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            {tasks.isPending ? (
              <p>Loading tasks…</p>
            ) : tasks.error ? (
              <p className={cx("error")}>{errorMessage(tasks.error)}</p>
            ) : tasks.data?.items.length ? (
              tasks.data.items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  groups={allGroups}
                  disabled={
                    !connected ||
                    command.busy ||
                    command.uncertain ||
                    scheduling.blocked
                  }
                  onComplete={complete}
                  onOpen={() => open({ type: "detail", task: t })}
                />
              ))
            ) : (
              <div className={cx("empty-state")}>
                <ListTodo size={30} />
                <h3>A little space to begin.</h3>
                <p>No tasks match this view.</p>
                <button
                  onClick={() => open({ type: "new" })}
                  className={cx("", true)}
                >
                  Add your first task
                </button>
              </div>
            )}
            <div className={cx("pagination")}>
              {cursor && (
                <button onClick={() => setCursor("")} className={cx("", true)}>
                  First page
                </button>
              )}
              {tasks.data?.nextCursor && (
                <button
                  onClick={() => setCursor(tasks.data!.nextCursor!)}
                  className={cx("", true)}
                >
                  Next 100 tasks
                </button>
              )}
            </div>
          </section>
        )}
        {page === "progress" && (
          <section className={cx("report-card")}>
            <div className={cx("list-heading")}>
              <div>
                <h2>
                  {dateLabel(
                    reportFrom,
                    period === "week" ? "MMM d" : "MMMM yyyy",
                  )}
                  {period === "week"
                    ? ` – ${dateLabel(DateTime.fromISO(reportTo).minus({ days: 1 }).toISODate()!, "MMM d, yyyy")}`
                    : ""}
                </h2>
                <p className={cx("muted")}>
                  All tasks included. Select a day to see its details.
                </p>
              </div>
              <div className={cx("report-controls")}>
                <input
                  type="date"
                  aria-label="Report date"
                  value={periodDate}
                  onChange={(e) => {
                    if (e.target.value) setPeriodDate(e.target.value);
                  }}
                  className={cx("", true)}
                />
                <button
                  aria-label="Previous period"
                  onClick={() =>
                    setPeriodDate(
                      periodStart
                        .minus(period === "week" ? { weeks: 1 } : { months: 1 })
                        .toISODate()!,
                    )
                  }
                  className={cx("", true)}
                >
                  ←
                </button>
                <button
                  onClick={() => setPeriodDate(date)}
                  className={cx("", true)}
                >
                  Today
                </button>
                <button
                  aria-label="Next period"
                  onClick={() =>
                    setPeriodDate(
                      periodStart
                        .plus(period === "week" ? { weeks: 1 } : { months: 1 })
                        .toISODate()!,
                    )
                  }
                  className={cx("", true)}
                >
                  →
                </button>
                <select
                  aria-label="Progress period"
                  value={period}
                  onChange={(e) =>
                    setPeriod(e.target.value as "week" | "month")
                  }
                  className={cx("", true)}
                >
                  <option value="week">Weekly</option>
                  <option value="month">Monthly</option>
                </select>
              </div>
            </div>
            {report.data && (
              <AnalyticsSummary
                report={report.data}
                onDay={(date) => open({ type: "day", date })}
              />
            )}
            {report.error ? (
              <p className={cx("error")}>{errorMessage(report.error)}</p>
            ) : report.isPending ? (
              <p>Loading progress…</p>
            ) : (
              <div className={cx(`report-days ${period}`)}>
                <DayStrip
                  selectedDate={selectedReportDate}
                  month={period === "month"}
                  days={report.data?.days || []}
                  onOpen={(date) => open({ type: "day", date })}
                />
              </div>
            )}
            <ProgressLegend />
          </section>
        )}
        {page === "groups" && (
          <Groups
            owner={account.user.id}
            groups={allGroups}
            execute={execute}
            disabled={!connected}
          />
        )}
        {page === "settings" && (
          <>
            <SettingsForm
              owner={account.user.id}
              settings={account.settings}
              execute={execute}
              refresh={refresh}
              disabled={!connected}
            />
            <NotificationSettings
              key={account.user.id}
              owner={account.user.id}
              read={read}
              execute={execute}
              disabled={!connected}
            />
          </>
        )}
      </main>
      {panel?.type === "new" || panel?.type === "edit" ? (
        <TaskEditor
          defaultFocusMinutes={account.settings.focusMinutes}
          key={panel.type === "edit" ? panel.task.id : "new"}
          onStateChange={setEditorState}
          onDraftChange={page === "calendar" ? setDraftPreview : undefined}
          owner={account.user.id}
          zone={account.settings.timezone}
          groups={allGroups}
          task={panel.type === "edit" ? panel.task : undefined}
          seed={panel.seed}
          disabled={!connected}
          execute={execute}
          onClose={() => {
            setDraftPreview(null);
            setPanel(null);
          }}
          onSaved={(created) => {
            setDraftPreview(null);
            setEditorState({ dirty: false, blocked: false });
            setPanel(null);
            if (!created) return;
            if (!created.scheduledDate) setUnscheduledOpen(true);
            if (page === "calendar") {
              setSearch("");
              setGroup("");
              setPriority("");
              setStatus("");
            }
            setSaveNotice(
              created.scheduledDate
                ? page === "calendar"
                  ? "Task created. Calendar filters cleared to show your new task."
                  : "Task created."
                : "Task created in Unscheduled. Add a scheduled date to place it on the calendar.",
            );
          }}
        />
      ) : panel?.type === "detail" ? (
        <TaskDetail
          defaultFocusMinutes={account.settings.focusMinutes}
          key={panel.task.id + String(panel.historical)}
          task={panel.task}
          historical={!!panel.historical}
          zone={account.settings.timezone}
          groups={allGroups}
          execute={execute}
          disabled={
            !connected ||
            command.busy ||
            command.uncertain ||
            scheduling.blocked
          }
          onClose={() => setPanel(null)}
          onEdit={() => open({ type: "edit", task: panel.task })}
          onCurrent={() => void openCurrent(panel.task)}
          onComplete={complete}
          onFocus={() => {
            setFocusTask(panel.task);
            setShowFocus(true);
          }}
          onDeleted={(task) => {
            setPanel(null);
            setRecovery({
              kind: "task",
              id: task.id,
              revision: task.revision + 1,
            });
          }}
          onStopped={(id, revision) => {
            setPanel(null);
            setRecovery({ kind: "series", id, revision });
          }}
        />
      ) : panel?.type === "day" ? (
        <SidebarPanel
          className={cx("day-detail")}
          label="Day details"
          eyebrow="DAILY PROGRESS"
          title={dateLabel(panel.date, "EEEE, MMM d")}
          closeLabel="Close day details"
          onClose={() => setPanel(null)}
        >
          {day.isPending ? (
            <p>Loading day…</p>
          ) : day.error ? (
            <p className={cx("error")}>{errorMessage(day.error)}</p>
          ) : (
            day.data && (
              <>
                <Ring
                  value={day.data.percentage}
                  ratio={completionRatio(day.data)}
                />
                <p>
                  {day.data.completed} of {day.data.planned} tasks complete
                </p>
                <small>
                  {day.data.finalized
                    ? `Historical plan · ${day.data.timezone} · editable`
                    : panel.date > date
                      ? "Planned for the future"
                      : "Live progress · all tasks"}
                </small>
                <p className={cx("day-encouragement")}>
                  {day.data.percentage === 100
                    ? "This plan is complete."
                    : day.data.completed > 0
                      ? "Each completed task is part of your progress."
                      : day.data.finalized
                        ? "A record of your plan for this day."
                        : panel.date > date
                          ? "Your plan for this upcoming day."
                          : "One small step is a good place to start."}
                </p>
                <DayFocusDetails day={day.data} />
                <div className={cx("day-tasks")}>
                  {day.data.entries.map((e) => (
                    <TaskRow
                      key={e.task.id}
                      task={e.task}
                      historical
                      groups={
                        e.task.groupId && e.groupName
                          ? [
                              {
                                id: e.task.groupId,
                                name: e.groupName,
                                color: e.groupColor || "#999",
                                revision: 1,
                              },
                            ]
                          : []
                      }
                      onOpen={() =>
                        open({
                          type: "detail",
                          task: e.task,
                          historical: day.data!.finalized,
                        })
                      }
                    />
                  ))}
                </div>
                {!day.data.planned && (
                  <p className={cx("muted")}>No tasks planned for this day.</p>
                )}
              </>
            )
          )}
        </SidebarPanel>
      ) : null}
    </div>
  );
}
