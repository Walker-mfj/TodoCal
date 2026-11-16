"use client";
import { bindStyles } from "../../../shared/utils/classNames";
const cx = bindStyles();

import {
  ToastProvider,
  ToastNotice,
} from "../../../shared/components/toast/toast";
import type { CalendarDraft } from "../../../features/calendar";
import { useConfirm } from "../../../shared/components/appDialog/appDialog";
import { sessionStore } from "../../../shared/utils/sessionStorage";
import { useCallback, useEffect, useState } from "react";
import { DateTime } from "luxon";
import type { PeriodReport, AnalyticsDay } from "../../../features/analytics";
import { useFocus } from "../../../features/focus";
import { FloatingFocus } from "../../../features/focus";
import { TimerPanel } from "../../../features/focus";
import { useSession } from "../../../features/auth";
import { useOwnedQuery } from "../../../features/auth";
import { AuthScreen } from "../../../features/auth";
import { TaskEditor } from "../../../features/tasks";
import { RecoveryToast, type RecoveryItem } from "../../../features/tasks";
import { TaskDetail } from "../../../features/tasks";
import { Groups } from "../../../features/tasks";
import { SettingsForm } from "../../../features/settings";
import { DailyProgress, Calendar } from "../../../features/calendar";
import { useWallClock } from "../../../shared/hooks/useWallClock";
import { type Draft } from "../../../features/tasks";
import {
  type Task,
  type Group,
  type Day,
  type CalendarRange,
} from "../../../shared/api/domainTypes";
import { errorMessage } from "../../../shared/api/apiClient";
import { useSchedule } from "../../../features/calendar";
import { ScheduleScopeDialog } from "../../../features/calendar";
import { UndoToast } from "../../../features/calendar";
import { useCommand } from "../../../shared/hooks/useCommand";
import { WorkspaceSidebar } from "../workspaceSidebar/workspaceSidebar";
import {
  WorkspaceLayout,
  WorkspaceMain,
} from "../workspaceLayout/workspaceLayout";
import { WorkspaceHeading } from "../workspaceHeading/workspaceHeading";
import { TaskFilters } from "../taskFilters/taskFilters";
import { TaskListPanel } from "../taskListPanel/taskListPanel";
import { ProgressPanel } from "../progressPanel/progressPanel";
import { DayDetailPanel } from "../dayDetailPanel/dayDetailPanel";
import { CalendarWorkspace } from "../calendarWorkspace/calendarWorkspace";
import { useWorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";
import { useTaskFilters } from "../../hooks/useTaskFilters";
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
  const {
    page,
    updatePage,
    showFocus,
    setShowFocus,
    sidebarCollapsed,
    toggleSidebar,
  } = useWorkspaceNavigation(account.user.id);
  const [focusHidden, setFocusHidden] = useState(false);
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const now = useWallClock(account.settings.timezone);
  const date = now.slice(0, 10);
  const [panel, setPanel] = useState<Panel>(null);
  const [message, setMessage] = useState("");
  const {
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
  } = useTaskFilters();
  const editingTaskId = panel?.type === "edit" ? panel.task.id : undefined;
  const onDraftChange = useCallback(
    ({ title, priority, scheduledDate, startTime, endTime }: Draft) => {
      setDraftPreview({
        draft: { title, priority, scheduledDate, startTime, endTime },
        taskId: editingTaskId,
      });
    },
    [editingTaskId],
  );
  const [recovery, setRecovery] = useState<RecoveryItem | null>(null);
  const [saveNotice, setSaveNotice] = useState("");
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
  const allGroups = groups.data?.items || [];
  return (
    <WorkspaceLayout hasPanel={!!panel} sidebarCollapsed={sidebarCollapsed}>
      <WorkspaceSidebar
        page={page}
        sidebarCollapsed={sidebarCollapsed}
        toggleSidebar={toggleSidebar}
        allGroups={allGroups}
        onNew={() => void open({ type: "new" })}
        onPage={setPage}
        onGroup={(id) => {
          setGroup(id);
          setPage("tasks");
        }}
        email={account.user.email}
        connected={connected}
        focusHidden={focusHidden}
        onToggleFocus={() => setFocusHidden((hidden) => !hidden)}
        onSignOut={async () => {
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
      />
      <WorkspaceMain page={page}>
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

        <WorkspaceHeading
          page={page}
          date={date}
          zone={account.settings.timezone}
        />
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
            <TaskFilters
              search={search}
              setSearch={setSearch}
              group={group}
              setGroup={setGroup}
              priority={priority}
              setPriority={setPriority}
              status={status}
              setStatus={setStatus}
              allGroups={allGroups}
            />
          </>
        )}
        {page === "calendar" && (
          <CalendarWorkspace
            calendar={calendar}
            unscheduled={unscheduled}
            unscheduledOpen={unscheduledOpen}
            setUnscheduledOpen={setUnscheduledOpen}
            allGroups={allGroups}
            filter={filter}
            taskActionsDisabled={
              !connected ||
              command.busy ||
              command.uncertain ||
              scheduling.blocked
            }
            complete={complete}
            onTask={(task) => void open({ type: "detail", task })}
            onCreate={() => void open({ type: "new" })}
            onViewAll={() => {
              setView("unscheduled");
              setPage("tasks");
            }}
          >
            <Calendar
              focus={{
                active: focus.active,
                receivedAt: focus.receivedAt,
                blocked: focus.blocked,
                start: focus.start,
                change: focus.change,
              }}
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
              timezone={account.settings.timezone}
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
          </CalendarWorkspace>
        )}
        {page === "tasks" && (
          <TaskListPanel
            tasks={tasks}
            allGroups={allGroups}
            disabled={
              !connected ||
              command.busy ||
              command.uncertain ||
              scheduling.blocked
            }
            complete={complete}
            onOpen={(task) => void open({ type: "detail", task })}
            onCreate={() => void open({ type: "new" })}
            view={view}
            setView={setView}
            cursor={cursor}
            setCursor={setCursor}
          />
        )}
        {page === "progress" && (
          <ProgressPanel
            report={report}
            reportFrom={reportFrom}
            reportTo={reportTo}
            period={period}
            setPeriod={setPeriod}
            periodDate={periodDate}
            setPeriodDate={setPeriodDate}
            selectedReportDate={selectedReportDate}
            date={date}
            onDay={(date) => void open({ type: "day", date })}
          />
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
              key={account.user.id}
              owner={account.user.id}
              settings={account.settings}
              read={read}
              execute={execute}
              refresh={refresh}
              disabled={!connected}
            />
          </>
        )}
      </WorkspaceMain>
      {panel?.type === "new" || panel?.type === "edit" ? (
        <TaskEditor
          defaultFocusMinutes={account.settings.focusMinutes}
          key={panel.type === "edit" ? panel.task.id : "new"}
          onStateChange={setEditorState}
          onDraftChange={page === "calendar" ? onDraftChange : undefined}
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
        <DayDetailPanel
          day={day}
          selectedDate={panel.date}
          date={date}
          onClose={() => setPanel(null)}
          onTask={(task, historical) =>
            void open({ type: "detail", task, historical })
          }
        />
      ) : null}
    </WorkspaceLayout>
  );
}
