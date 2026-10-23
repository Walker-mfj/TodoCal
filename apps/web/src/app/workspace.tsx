"use client";
import { sessionStore } from "../lib/session-storage";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { DateTime } from "luxon";
import {
  CalendarDays,
  ListTodo,
  ChartNoAxesColumn,
  Settings2,
  Folder,
  Plus,
  LogOut,
  Wifi,
  WifiOff,
  Search,
  X,
  ArrowUpRight,
} from "lucide-react";
import {
  AnalyticsSummary,
  DayFocusDetails,
  type PeriodReport,
  type AnalyticsDay,
} from "../features/analytics/AnalyticsSummary";
import { completionRatio } from "../lib/model";
import { useFocus } from "../features/focus/useFocus";
import { TimerBar } from "../features/focus/TimerBar";
import { TimerPanel } from "../features/focus/TimerPanel";
import { useSession, useOwnedQuery } from "./providers";
import { AuthScreen } from "../features/auth/auth-screen";
import { TaskEditor } from "../features/tasks/editor";
import { TaskDetail } from "../features/tasks/detail";
import { TaskRow } from "../features/tasks/task-row";
import { Groups } from "../features/tasks/groups";
import { SettingsForm } from "../features/settings/settings-form";
import {
  DailyProgress,
  DayStrip,
  ProgressLegend,
  Ring,
} from "../features/calendar/progress";
import {
  dateLabel,
  today,
  type Draft,
  type Task,
  type Group,
  type Day,
  type CalendarRange,
} from "../lib/model";
import { errorMessage } from "../lib/api";
import { useSchedule } from "../features/calendar/use-schedule";
import { UndoToast } from "../features/calendar/UndoToast";
import { useCommand } from "../lib/use-command";
const Calendar = dynamic(() => import("../features/calendar/calendar"), {
  ssr: false,
  loading: () => <div className="loading">Loading calendar…</div>,
});
type Panel =
  | { type: "new"; seed?: Partial<Draft> }
  | { type: "edit" | "detail"; task: Task; historical?: boolean }
  | { type: "day"; date: string }
  | null;
export default function Workspace() {
  const { session, loading } = useSession();
  if (loading || !session) return <AuthScreen />;
  return <AccountWorkspace key={session.user.id} />;
}
function AccountWorkspace() {
  const { session, connected, execute, read, refresh, logout } = useSession();
  const account = session!;
  const focus = useFocus();
  const [showFocus, setShowFocus] = useState(false);
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const date = today(account.settings.timezone);
  const [page, setPage] = useState("calendar"),
    [panel, setPanel] = useState<Panel>(null),
    [search, setSearch] = useState(""),
    [group, setGroup] = useState(""),
    [priority, setPriority] = useState(""),
    [status, setStatus] = useState(""),
    [view, setView] = useState("all"),
    [cursor, setCursor] = useState(""),
    [message, setMessage] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [reveal, setReveal] = useState<Partial<Draft> | null>(null);
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
  const open = (next: Panel) => {
    if (panel?.type === "edit" || panel?.type === "new") {
      if (!confirm("Close the editor? Your draft will be kept for this task."))
        return;
    }
    if (next?.type === "day") setSelectedReportDate(next.date);
    setPanel(next);
    setSaveNotice("");
    setMessage("");
  };
  const complete = (task: Task) => {
    const move =
      task.status !== "complete" &&
      !!task.scheduledDate &&
      task.scheduledDate > date;
    if (move && !confirm("Move this future task to today and complete it?"))
      return;
    void command.run(
      `/tasks/${task.id}/completion`,
      "POST",
      {
        complete: task.status !== "complete",
        expectedRevision: task.revision,
        moveToToday: move,
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
    <div className={`app-shell ${panel ? "has-panel" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">f.</span>
          <span>
            focus
            <br />
            calendar
          </span>
        </div>
        <button
          className="primary new-task"
          onClick={() => open({ type: "new" })}
        >
          <Plus size={17} />
          New task
        </button>
        <button
          className="focus-open"
          onClick={() => {
            setFocusTask(null);
            setShowFocus(true);
          }}
        >
          Focus timer
        </button>
        <nav aria-label="Main navigation">
          {navigation.map(([key, label, Icon]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => setPage(key)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-groups">
          <p className="eyebrow">YOUR GROUPS</p>
          {allGroups.length ? (
            allGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  setGroup(g.id);
                  setPage("tasks");
                }}
              >
                <i className="dot" style={{ background: g.color }} />
                {g.name}
              </button>
            ))
          ) : (
            <p className="muted">A little structure helps.</p>
          )}
          <button className="text-button" onClick={() => setPage("groups")}>
            <Plus size={14} />
            Manage groups
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="connection">
            {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>{connected ? "Connected" : "Disconnected"}</span>
          </div>
          <small className="account-email" title={account.user.email}>
            {account.user.email}
          </small>
          <button
            disabled={!connected}
            onClick={() => {
              if (
                (panel?.type === "new" || panel?.type === "edit") &&
                !confirm("Sign out and discard your saved drafts?")
              )
                return;
              void logout().catch((e) => setMessage(errorMessage(e)));
            }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      <main id="main" className="workspace">
        {scheduling.busy && (
          <div className="notice" role="status">
            Saving calendar change…
          </div>
        )}
        {scheduling.error && (
          <div className="error" role="alert">
            {scheduling.error}
            {scheduling.pending ? (
              <button
                disabled={!connected || scheduling.busy}
                onClick={scheduling.retry}
              >
                Retry calendar change
              </button>
            ) : (
              <button onClick={scheduling.dismiss}>Dismiss</button>
            )}
          </div>
        )}
        {scheduling.toast && (
          <UndoToast
            {...scheduling.toast}
            onUndo={scheduling.undo}
            onExpire={scheduling.expire}
            disabled={!connected || scheduling.blocked}
          />
        )}

        <header className="workspace-heading">
          <div>
            <p className="eyebrow">
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
            <p className="muted">
              {page === "calendar"
                ? "A clear plan. A little breathing room."
                : page === "progress"
                  ? "Small steps add up. Explore each day of your week or month."
                  : "Your plans, at your own pace."}
            </p>
          </div>
          <span className="workspace-label">CLEAR WEEK</span>
        </header>
        {!connected && (
          <div role="status" className="notice connection-banner">
            You’re disconnected. Saved data may be out of date; changes are
            disabled.<button onClick={() => void refresh()}>Reconnect</button>
          </div>
        )}
        <TimerBar focus={focus} onOpen={() => setShowFocus(true)} />
        {focus.command.error && (
          <div role="alert" className="error">
            {focus.command.error}
          </div>
        )}
        {focus.command.uncertain && (
          <div className="notice">
            A timer action is unconfirmed.{" "}
            <button
              disabled={!connected || focus.command.busy}
              onClick={focus.retry}
            >
              Retry timer action
            </button>
          </div>
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
          <div role="status" className="notice">
            {saveNotice}
          </div>
        )}
        {(message || command.error) && (
          <div role="alert" className="error">
            {message || command.error}
            {command.uncertain && (
              <button
                disabled={!connected || command.busy}
                onClick={() =>
                  void command.run("", "", null, () => setPanel(null))
                }
              >
                Retry request
              </button>
            )}
          </div>
        )}
        {restoredDrafts.length > 0 && !panel && (
          <div className="notice">
            You have a saved task draft.
            <button
              onClick={() => {
                const id = restoredDrafts[0].split(":").pop();
                void read<Task>(`/tasks/${id}`)
                  .then((task) => open({ type: "edit", task }))
                  .catch((e) => setMessage(errorMessage(e)));
              }}
            >
              Resume draft
            </button>
            <button
              onClick={() => {
                if (confirm("Discard saved task drafts?")) {
                  restoredDrafts.forEach((k) => sessionStore.removeItem(k));
                  setMessage("Drafts discarded.");
                }
              }}
            >
              Discard
            </button>
          </div>
        )}
        {(page === "calendar" || page === "tasks") && (
          <>
            <DailyProgress
              day={todayReport.data}
              onOpen={(date) => open({ type: "day", date })}
            />
            <div className="filters">
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="Search tasks"
                  placeholder="Search tasks…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <select
                aria-label="Filter group"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
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
            <div className="calendar-card">
              {calendar.error ? (
                <p className="error" role="alert">
                  {errorMessage(calendar.error)}
                  <button onClick={() => void calendar.refetch()}>
                    Retry calendar
                  </button>
                </p>
              ) : null}
              {calendar.data?.days.length === 7 && (
                <DayStrip
                  days={calendar.data.days}
                  onOpen={(date) => open({ type: "day", date })}
                />
              )}
              <Calendar
                onDay={(date) => open({ type: "day", date })}
                reveal={reveal}
                days={calendar.data?.days || []}
                groups={allGroups}
                today={date}
                onRange={setRangeStable}
                onTask={(task, historical) =>
                  open({ type: "detail", task, historical })
                }
                onCreate={(seed) => {
                  if (seed.scheduledDate! < date) {
                    setMessage(
                      "Past days are read-only. Choose today or a future date.",
                    );
                    return;
                  }
                  open({ type: "new", seed });
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
              <p className="notice">
                Some repeating tasks fall in a daylight-saving time gap and were
                skipped: {calendar.data.warnings.map((w) => w.date).join(", ")}.
              </p>
            )}
            <section className="unscheduled-section">
              <div className="section-title">
                <h2>Without a date</h2>
                <button
                  className="text-button"
                  onClick={() => {
                    setView("unscheduled");
                    setPage("tasks");
                  }}
                >
                  View all <ArrowUpRight size={14} />
                </button>
              </div>
              <p className="muted">
                Keep an idea here until you’re ready to make room.
              </p>
              {unscheduled.error ? (
                <p className="error">{errorMessage(unscheduled.error)}</p>
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
                  className="empty-add"
                  onClick={() => open({ type: "new" })}
                >
                  + Capture a task, no date needed
                </button>
              )}
            </section>
          </>
        )}
        {page === "tasks" && (
          <section className="task-list-card">
            <div className="list-heading">
              <h2>Your tasks</h2>
              <select
                aria-label="Task view"
                value={view}
                onChange={(e) => setView(e.target.value)}
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
              <p className="error">{errorMessage(tasks.error)}</p>
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
              <div className="empty-state">
                <ListTodo size={30} />
                <h3>A little space to begin.</h3>
                <p>No tasks match this view.</p>
                <button onClick={() => open({ type: "new" })}>
                  Add your first task
                </button>
              </div>
            )}
            <div className="pagination">
              {cursor && (
                <button onClick={() => setCursor("")}>First page</button>
              )}
              {tasks.data?.nextCursor && (
                <button onClick={() => setCursor(tasks.data!.nextCursor!)}>
                  Next 100 tasks
                </button>
              )}
            </div>
          </section>
        )}
        {page === "progress" && (
          <section className="report-card">
            <div className="list-heading">
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
                <p className="muted">
                  All tasks included. Select a day to see its details.
                </p>
              </div>
              <div className="report-controls">
                <input
                  type="date"
                  aria-label="Report date"
                  value={periodDate}
                  onChange={(e) => {
                    if (e.target.value) setPeriodDate(e.target.value);
                  }}
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
                >
                  ←
                </button>
                <button onClick={() => setPeriodDate(date)}>Today</button>
                <button
                  aria-label="Next period"
                  onClick={() =>
                    setPeriodDate(
                      periodStart
                        .plus(period === "week" ? { weeks: 1 } : { months: 1 })
                        .toISODate()!,
                    )
                  }
                >
                  →
                </button>
                <select
                  aria-label="Progress period"
                  value={period}
                  onChange={(e) =>
                    setPeriod(e.target.value as "week" | "month")
                  }
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
              <p className="error">{errorMessage(report.error)}</p>
            ) : report.isPending ? (
              <p>Loading progress…</p>
            ) : (
              <div className={`report-days ${period}`}>
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
          <SettingsForm
            owner={account.user.id}
            settings={account.settings}
            execute={execute}
            refresh={refresh}
            disabled={!connected}
          />
        )}
      </main>
      {panel?.type === "new" || panel?.type === "edit" ? (
        <TaskEditor
          key={panel.type === "edit" ? panel.task.id : "new"}
          owner={account.user.id}
          zone={account.settings.timezone}
          groups={allGroups}
          task={panel.type === "edit" ? panel.task : undefined}
          seed={panel.type === "new" ? panel.seed : undefined}
          disabled={!connected}
          execute={execute}
          onClose={() => setPanel(null)}
          onSaved={(created) => {
            setPanel(null);
            if (!created) return;
            if (page === "calendar") {
              setSearch("");
              setGroup("");
              setPriority("");
              setStatus("");
              setReveal({ ...created });
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
          key={panel.task.id + String(panel.historical)}
          task={panel.task}
          historical={!!panel.historical}
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
          onDeleted={() => setPanel(null)}
        />
      ) : panel?.type === "day" ? (
        <aside className="detail-panel day-detail">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">DAILY PROGRESS</p>
              <h2>{dateLabel(panel.date, "EEEE, MMM d")}</h2>
            </div>
            <button
              className="icon-button"
              aria-label="Close day details"
              onClick={() => setPanel(null)}
            >
              <X size={18} />
            </button>
          </div>
          {day.isPending ? (
            <p>Loading day…</p>
          ) : day.error ? (
            <p className="error">{errorMessage(day.error)}</p>
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
                    ? `Finalized in ${day.data.timezone}`
                    : panel.date > date
                      ? "Planned for the future"
                      : "Live progress · all tasks"}
                </small>
                <p className="day-encouragement">
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
                <div className="day-tasks">
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
                  <p className="muted">No tasks planned for this day.</p>
                )}
              </>
            )
          )}
        </aside>
      ) : (
        <aside className="detail-panel idle-panel">
          <p className="eyebrow">A LITTLE BREATHING ROOM</p>
          <div className="idle-art" aria-hidden="true">
            ✓
          </div>
          <h2>
            Start small.
            <br />
            Keep going.
          </h2>
          <p className="muted">
            Select a task to see its details, or make room for something new.
          </p>
          <button onClick={() => open({ type: "new" })}>
            <Plus size={16} />
            New task
          </button>
          <div className="focus-note">
            <h3>Your pace matters.</h3>
            <p>
              Tasks don’t need a timer. A completed step is progress all the
              same.
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}
