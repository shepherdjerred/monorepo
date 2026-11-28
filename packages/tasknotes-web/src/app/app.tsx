import type { Task } from "@shepherdjerred/facet-protocol";
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { Link } from "react-router";
import { today } from "#workspace/civil-day.ts";
import { ConnectScreen } from "#ui/connect-screen.tsx";
import { useDraftGuard, useWorkspaceKeys } from "./navigation-effects.ts";
import { OrganizationTools } from "#workspace/organization.tsx";
import { usePreferences, useProjectPreferences } from "./preferences.ts";
import {
  changeQuery,
  destinationPath,
  upcomingPath,
  upcomingWeekOffset,
} from "./routes.ts";
import { WorkspaceConnection } from "./workspace-connection.tsx";
import { WorkspaceSettings } from "./settings.tsx";
import { reportAction } from "./ui-action.ts";
import { BulkSchedule, WorkspaceBoard } from "#workspace/workspace-board.tsx";
import { useCapture } from "./workspace-capture.tsx";
import { DecisionDialog } from "./workspace-dialog.tsx";
import { workspaceEngine } from "#sync/workspace-engine.ts";
import { useWorkspaceLocation } from "./workspace-location.ts";
import { useWorkspaceMutations } from "./workspace-mutations.ts";
import { WorkspaceScreen } from "#ui/workspace-screen.tsx";
import { WorkspaceSearch } from "#workspace/workspace-search.tsx";
import { workspaceView } from "#workspace/workspace-view.ts";
import {
  defaultProjectPreferences,
  type ProjectPreferences,
  type TaskGroup,
} from "#workspace/workspace.ts";

const headings = {
  browse: "Browse",
  search: "Search",
  settings: "Settings",
  missing: "Page unavailable",
};

const TaskEditor = lazy(async () => {
  const { TaskEditor: Editor } = await import("./task-editor.tsx");
  return { default: Editor };
});

function statusText(
  status: ReturnType<typeof workspaceEngine.getSnapshot>,
): string | null {
  if (status.syncStatus === "local") return "On this device";
  if (status.syncStatus === "syncing") return "Syncing…";
  if (status.syncStatus === "offline") return "Offline";
  if (status.pendingCount > 0)
    return `${status.pendingCount.toString()} pending`;
  return status.syncStatus === "synced" ? "Up to date" : null;
}

export function App() {
  const snapshot = useSyncExternalStore(
    workspaceEngine.subscribe,
    workspaceEngine.getSnapshot,
  );
  const [preferences, onPreferences] = usePreferences();
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    void workspaceEngine.initialize();
  }, []);

  if (snapshot.phase === "loading") {
    return (
      <main className="gate">
        <p role="status">Opening Facet…</p>
      </main>
    );
  }
  if (snapshot.phase === "setup") {
    return (
      <ConnectScreen
        initialOrigin=""
        initialToken=""
        initialRemember={false}
        error={snapshot.error ?? setupError}
        busy={snapshot.syncStatus === "syncing"}
        onSubmit={(session) => {
          setSetupError(null);
          void reportAction(
            () => workspaceEngine.connect(session),
            setSetupError,
          );
        }}
        onContinueLocally={() => {
          setSetupError(null);
          void reportAction(() => workspaceEngine.startLocal(), setSetupError);
        }}
      />
    );
  }
  return (
    <Workspace
      key={snapshot.profile?.key ?? "workspace"}
      snapshot={snapshot}
      preferences={preferences}
      onPreferences={onPreferences}
    />
  );
}

type WorkspaceProps = {
  snapshot: ReturnType<typeof workspaceEngine.getSnapshot>;
  preferences: ReturnType<typeof usePreferences>[0];
  onPreferences: ReturnType<typeof usePreferences>[1];
};

function Workspace(props: WorkspaceProps) {
  const { snapshot } = props;
  const { data, canWrite } = snapshot;
  const [dirty, setDirty] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const blocker = useDraftGuard(dirty);
  const navigation = useWorkspaceLocation(snapshot.tempIdMapping, dirty);
  const {
    route,
    taskId,
    go,
    changeSearch,
    showSearch,
    taskHref,
    openTask,
    closeTask,
  } = navigation;
  const { destination } = route;
  const { onCommand, toggle, undo, performUndo } = useWorkspaceMutations(
    data.tasks,
    props.preferences.sound,
  );
  const timeZone =
    new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const currentDay = today(timeZone);
  const upcomingOffset = upcomingWeekOffset(currentDay, route.upcomingDay);
  const projectId = destination.kind === "project" ? destination.id : null;
  const projectDisplay = useProjectPreferences(
    snapshot.profile?.key ?? "local",
    projectId,
  );
  const projectPreferences =
    projectDisplay.preferences ?? defaultProjectPreferences;
  const activeView = workspaceView({
    data,
    destination,
    search: "",
    today: currentDay,
    timeZone,
    upcomingOffset,
    projectPreferences,
  });
  const view =
    route.screen === "tasks"
      ? activeView
      : {
          title: headings[route.screen],
          groups: [],
          week: [],
        };
  const selected =
    data.tasks.find((task) => task.id === taskId && !task.is_deleted) ?? null;

  const { openCapture, captureGroup, captureDialog } = useCapture({
    data,
    destination,
    today: currentDay,
    timeZone,
    selectedDay: route.upcomingDay,
    canWrite,
    onCommand,
  });

  useWorkspaceKeys({
    search: showSearch,
    closeTask,
    taskOpen: selected !== null,
  });

  useEffect(() => {
    document.title = `${selected?.title ?? view.title} · Facet`;
  }, [selected?.title, view.title]);

  const listActions =
    route.screen === "tasks" || route.screen === "browse" ? (
      <OrganizationTools
        data={data}
        destination={destination}
        onCommand={onCommand}
        today={currentDay}
        timeZone={timeZone}
        canWrite={canWrite}
        {...(projectId === null ? {} : { preferences: projectPreferences })}
        onPreferences={projectDisplay.save}
      />
    ) : null;
  const listBody = workspaceBody({
    ...props,
    navigation,
    projectId,
    projectPreferences,
    mutations: { onCommand, toggle },
    onAskDelete: setTaskToDelete,
  });
  const inspector =
    selected === null ? null : (
      <Suspense
        fallback={
          <p role="status" className="empty">
            Opening task…
          </p>
        }
      >
        <TaskEditor
          key={selected.id}
          task={selected}
          data={data}
          today={currentDay}
          timeZone={timeZone}
          onCommand={onCommand}
          canWrite={canWrite}
          onDirtyChange={setDirty}
          onClose={closeTask}
          onToggle={() => {
            toggle(selected);
          }}
          onOpenTask={openTask}
        />
      </Suspense>
    );
  return (
    <>
      <WorkspaceScreen
        data={data}
        view={view}
        destination={destination}
        today={currentDay}
        timeZone={timeZone}
        upcomingOffset={upcomingOffset}
        selected={selected}
        search={route.query}
        status={statusText(snapshot)}
        error={snapshot.error}
        canWrite={canWrite}
        {...(route.screen === "tasks" ? {} : { screenTitle: view.title })}
        showSync={snapshot.profile?.kind === "connected"}
        destinationHref={destinationPath}
        taskHref={taskHref}
        browseActive={route.screen === "browse"}
        browseHref="/browse"
        onBrowse={() => {
          go("/browse");
        }}
        onSearch={changeSearch}
        onOpenSearch={showSearch}
        onDestination={(next) => {
          go(destinationPath(next));
        }}
        onUpcomingOffset={(offset) => {
          go(upcomingPath(currentDay, offset));
        }}
        {...(route.upcomingDay === null
          ? {}
          : { upcomingDay: route.upcomingDay })}
        onUpcomingDay={(date) => {
          go(changeQuery("/upcoming", "", { date }));
        }}
        upcomingDayHref={(date) => changeQuery("/upcoming", "", { date })}
        onToggle={toggle}
        onOpen={openTask}
        onCloseInspector={closeTask}
        onCapture={openCapture}
        onAdd={(title) => {
          const project = destination.kind === "project" ? destination.id : "";
          void onCommand({
            type: "TaskAdd",
            args: {
              title,
              project_id: project,
              ...(destination.kind === "section" &&
              destination.section === "today"
                ? { due_date: currentDay }
                : {}),
            },
          });
        }}
        onRefresh={() => {
          void workspaceEngine.sync();
        }}
        onSignOut={() => {
          workspaceEngine.signOut();
        }}
        inspector={inspector}
        listActions={listActions}
        listBody={listBody}
        settingsAction={
          <Link className="text-button" to="/settings">
            Settings
          </Link>
        }
        groupActions={(group) => (
          <TaskGroupActions
            group={group}
            canWrite={canWrite}
            onCapture={captureGroup}
            today={currentDay}
            timeZone={timeZone}
            onCommand={onCommand}
          />
        )}
        statusAction={
          undo === null ? null : (
            <div className="undo-bar" role="status">
              {undo.label}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  void performUndo();
                }}
              >
                Undo
              </button>
            </div>
          )
        }
        capture={captureDialog}
      />
      {selected === null && route.taskId !== null ? (
        <div className="missing-task" role="status">
          This task is unavailable.
          <button type="button" className="text-button" onClick={closeTask}>
            Dismiss
          </button>
        </div>
      ) : null}
      {blocker.state === "blocked" ? (
        <DecisionDialog
          title="Discard changes?"
          detail="You have an unsaved task edit."
          action="Discard changes"
          onDismiss={blocker.reset}
          onDecision={() => {
            if (selected !== null)
              void reportAction(() => workspaceEngine.clearDraft(selected.id));
            setDirty(false);
            blocker.proceed();
          }}
        />
      ) : null}
      <BoardDeleteDialog
        task={taskToDelete}
        onDismiss={() => {
          setTaskToDelete(null);
        }}
        onCommand={onCommand}
      />
    </>
  );
}

function BoardDeleteDialog(props: {
  task: Task | null;
  onDismiss: () => void;
  onCommand: ReturnType<typeof useWorkspaceMutations>["onCommand"];
}) {
  const { task, onDismiss, onCommand } = props;
  if (task === null) return null;
  return (
    <DecisionDialog
      title="Delete task?"
      detail={task.title}
      action="Delete task"
      onDismiss={onDismiss}
      onDecision={() => {
        onDismiss();
        void onCommand({ type: "TaskDelete", args: { id: task.id } });
      }}
    />
  );
}

function TaskGroupActions(props: {
  group: TaskGroup;
  today: string;
  timeZone: string;
  canWrite: boolean;
  onCapture: (group: TaskGroup) => void;
  onCommand: ReturnType<typeof useWorkspaceMutations>["onCommand"];
}) {
  if (!props.canWrite) return null;
  const { group } = props;
  return (
    <>
      {group.civilDate === undefined && group.sectionId === undefined ? null : (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            props.onCapture(group);
          }}
        >
          Add task
        </button>
      )}
      {group.overdue && group.tasks.length > 0 ? (
        <BulkSchedule
          tasks={group.tasks}
          today={props.today}
          timeZone={props.timeZone}
          onCommand={props.onCommand}
        />
      ) : null}
    </>
  );
}

function workspaceBody(
  props: WorkspaceProps & {
    navigation: ReturnType<typeof useWorkspaceLocation>;
    projectId: string | null;
    projectPreferences: ProjectPreferences;
    onAskDelete: (task: Task) => void;
    mutations: Pick<
      ReturnType<typeof useWorkspaceMutations>,
      "onCommand" | "toggle"
    >;
  },
) {
  const { navigation, snapshot } = props;
  const { route, go, changeSearch, openTask, search, taskHref } = navigation;
  switch (route.screen) {
    case "settings":
      return (
        <WorkspaceSettings
          preferences={props.preferences}
          onPreferences={props.onPreferences}
          connection={<WorkspaceConnection snapshot={snapshot} />}
        />
      );
    case "search":
      return (
        <WorkspaceSearch
          data={snapshot.data}
          query={route.query}
          onQuery={changeSearch}
          includeCompleted={route.includeCompleted}
          taskHref={taskHref}
          destinationHref={destinationPath}
          onIncludeCompleted={(included) => {
            go(
              changeQuery("/search", search, {
                completed: included ? "1" : null,
              }),
            );
          }}
          onOpenTask={openTask}
          onDestination={(next) => {
            go(destinationPath(next));
          }}
        />
      );
    case "missing":
      return (
        <p className="empty">
          This page could not be opened. <Link to="/today">Go to Today</Link>
        </p>
      );
    case "tasks":
      if (
        props.projectId === null ||
        props.projectPreferences.layout !== "board"
      )
        return;
      return (
        <WorkspaceBoard
          data={snapshot.data}
          projectId={props.projectId}
          preferences={props.projectPreferences}
          taskHref={taskHref}
          onOpenTask={openTask}
          onCommand={props.mutations.onCommand}
          onToggle={props.mutations.toggle}
          onAskDelete={props.onAskDelete}
          canWrite={snapshot.canWrite}
        />
      );
    case "browse":
      return;
  }
}
