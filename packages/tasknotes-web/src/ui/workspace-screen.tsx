import type { Task } from "@shepherdjerred/facet-protocol";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { formatMonthDay, type CivilDay } from "#workspace/civil-day.ts";
import { Icon, type IconName } from "./icons.tsx";
import {
  MobileTabBar,
  SearchForm,
  SearchLauncher,
  SidebarFrame,
  SidebarNav,
  WorkspaceFooter,
} from "./sidebar.tsx";
import type { WorkspaceData } from "#sync/sync.ts";
import { QuickAdd, TaskList } from "./task-list.tsx";
import { WeekStrip, WorkspaceTools } from "./workspace-controls.tsx";
import {
  activeLabels,
  activeProjects,
  inboxTasks,
  todayGroups,
  type Destination,
  type TaskGroup,
  type WorkspaceView,
} from "#workspace/workspace.ts";

type WorkspaceScreenProps = {
  data: WorkspaceData;
  view: WorkspaceView;
  destination: Destination;
  search: string;
  timeZone: string;
  today: CivilDay;
  upcomingOffset: number;
  selected: Task | null;
  status: string | null;
  error: string | null;
  onSearch: (value: string) => void;
  onDestination: (destination: Destination) => void;
  onUpcomingOffset: (offset: number) => void;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
  onCloseInspector: () => void;
  onAdd: (title: string) => void;
  onRefresh: () => void;
  onSignOut: () => void;
  destinationHref?: (destination: Destination) => string;
  taskHref?: (task: Task) => string;
  browseActive?: boolean;
  browseHref?: string;
  onBrowse?: () => void;
  upcomingDay?: CivilDay;
  upcomingDayHref?: (day: CivilDay) => string;
  onUpcomingDay?: (day: CivilDay) => void;
  onOpenSearch?: () => void;
  onCapture?: () => void;
  canWrite?: boolean;
  capture?: ReactNode;
  inspector?: ReactNode;
  listBody?: ReactNode;
  listActions?: ReactNode;
  statusAction?: ReactNode;
  showSync?: boolean;
  settingsAction?: ReactNode;
  extraNavigation?: ReactNode;
  screenTitle?: string;
  groupActions?: (group: TaskGroup) => ReactNode;
};

function focusCompose(): void {
  document.querySelector<HTMLInputElement>("#quick-add-field")?.focus();
}

function focusSearch(): void {
  const search = [
    ...document.querySelectorAll<HTMLInputElement>("input[type=search]"),
  ].find((field) => field.offsetParent !== null);
  search?.focus();
}

function sectionIcon(destination: Destination): IconName {
  if (destination.kind === "project") return "folder";
  if (destination.kind === "label") return "tag";
  if (destination.kind === "filter") return "filter";
  switch (destination.section) {
    case "inbox":
      return "tray";
    case "today":
      return "star";
    case "upcoming":
      return "calendar";
    case "completed":
      return "check";
  }
}

type NavState = Parameters<typeof SidebarNav>[0];
type FooterState = Parameters<typeof WorkspaceFooter>[0];

function useInspectorFocus(
  activeId: string | null,
  headingRef: RefObject<HTMLHeadingElement | null>,
) {
  const detailRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousTaskId = useRef<string | null>(null);

  useEffect(() => {
    if (activeId !== null) {
      detailRef.current?.focus({ preventScroll: true });
    } else if (previousTaskId.current !== null) {
      const previousLink = listRef.current?.querySelector<HTMLElement>(
        `[data-task-link="${CSS.escape(previousTaskId.current)}"]`,
      );
      (previousLink ?? headingRef.current)?.focus({ preventScroll: true });
    }
    previousTaskId.current = activeId;
  }, [activeId, headingRef]);

  return { detailRef, listRef };
}

function useWorkspaceShortcuts(props: {
  canWrite: boolean;
  onCapture: () => void;
  onOpenSearch: () => void;
}) {
  const { canWrite, onCapture, onOpenSearch } = props;
  useEffect(() => {
    function workspaceKeyboard(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing) return;
      if (document.querySelector("dialog:modal") !== null) return;
      const key = event.key.toLowerCase();
      if (key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenSearch();
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          event.target.matches("input, textarea, select"))
      )
        return;
      if (canWrite && key === "q") {
        event.preventDefault();
        onCapture();
      }
    }
    document.addEventListener("keydown", workspaceKeyboard);
    return () => {
      document.removeEventListener("keydown", workspaceKeyboard);
    };
  }, [canWrite, onCapture, onOpenSearch]);
}

function WorkspaceListHeader(props: {
  screen: WorkspaceScreenProps;
  browseActive: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const { screen, browseActive, headingRef } = props;
  const title = browseActive
    ? "Browse"
    : (screen.screenTitle ?? screen.view.title);
  const currentSectionIcon = sectionIcon(screen.destination);
  const icon = browseActive
    ? "grid"
    : screen.screenTitle === "Search"
      ? "search"
      : currentSectionIcon;
  const taskCount = screen.view.groups.reduce(
    (sum, group) => sum + group.tasks.length,
    0,
  );
  const isTaskList =
    !browseActive &&
    screen.screenTitle === undefined &&
    screen.listBody === undefined;
  const showDate =
    screen.destination.kind === "section" &&
    screen.destination.section === "today";
  return (
    <header className="list-heading">
      <div className="list-heading-title">
        <span className="section-icon">
          <Icon name={icon} />
        </span>
        <div>
          <h1 ref={headingRef} tabIndex={-1}>
            {title}
          </h1>
          {isTaskList ? (
            <p className="task-count">
              {showDate ? (
                <>
                  <time dateTime={screen.today}>
                    {formatMonthDay(screen.today)}
                  </time>
                  <span aria-hidden="true"> · </span>
                </>
              ) : null}
              {taskCount === 1 ? "1 task" : `${taskCount.toString()} tasks`}
            </p>
          ) : null}
        </div>
      </div>
      {screen.listActions === undefined ? null : (
        <div className="list-heading-actions">{screen.listActions}</div>
      )}
    </header>
  );
}

function WorkspaceTaskList(props: {
  screen: WorkspaceScreenProps;
  canWrite: boolean;
}) {
  const { screen } = props;
  const hasGroupCapture =
    screen.groupActions !== undefined &&
    screen.view.groups.some(
      (group) => group.civilDate !== undefined || group.sectionId !== undefined,
    );
  return (
    <>
      <WeekStrip {...screen} />
      <TaskList
        view={screen.view}
        tasks={screen.data.tasks}
        projects={activeProjects(screen.data.projects)}
        labels={activeLabels(screen.data.labels)}
        selectedId={screen.selected?.id}
        canWrite={props.canWrite}
        timeZone={screen.timeZone}
        today={screen.today}
        taskHref={screen.taskHref}
        groupActions={screen.groupActions}
        onToggle={screen.onToggle}
        onOpen={screen.onOpen}
      />
      {!hasGroupCapture && props.canWrite ? (
        <QuickAdd onAdd={screen.onAdd} onCapture={screen.onCapture} />
      ) : null}
    </>
  );
}

function WorkspacePanel(props: {
  screen: WorkspaceScreenProps;
  browseActive: boolean;
  canWrite: boolean;
  nav: NavState;
  footer: FooterState;
  listRef: RefObject<HTMLDivElement | null>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  openBrowse: () => void;
}) {
  const { screen, browseActive, canWrite } = props;
  const showBrowseBack = !browseActive && screen.destination.kind !== "section";
  return (
    <div
      className="list-panel"
      id="workspace-content"
      ref={props.listRef}
      tabIndex={-1}
    >
      <div className="list-column">
        <WorkspaceTools
          showBrowse={showBrowseBack}
          browseHref={screen.browseHref}
          onBrowse={props.openBrowse}
          onRefresh={screen.onRefresh}
          showSync={screen.showSync ?? true}
          settingsAction={screen.settingsAction}
        />
        <WorkspaceListHeader
          screen={screen}
          browseActive={browseActive}
          headingRef={props.headingRef}
        />
        {screen.screenTitle === "Search" ? null : screen.onOpenSearch ===
          undefined ? (
          <SearchForm
            className="header-search"
            value={screen.search}
            onSearch={screen.onSearch}
          />
        ) : (
          <SearchLauncher
            className="header-search"
            onOpen={screen.onOpenSearch}
          />
        )}
        {screen.error === null ? null : (
          <p className="alert workspace-alert" role="alert">
            {screen.error}
          </p>
        )}
        {screen.statusAction}
        {browseActive ? (
          <div className="browse-page">
            <SidebarNav {...props.nav} collectionsOnly />
            <WorkspaceFooter {...props.footer} />
          </div>
        ) : (
          (screen.listBody ?? (
            <WorkspaceTaskList screen={screen} canWrite={canWrite} />
          ))
        )}
      </div>
    </div>
  );
}

function WorkspaceInspector(props: {
  screen: WorkspaceScreenProps;
  detailRef: RefObject<HTMLElement | null>;
}) {
  const { screen } = props;
  return (
    <section
      className="task-detail"
      id="task-detail"
      ref={props.detailRef}
      tabIndex={-1}
      aria-label="Task details"
    >
      <button
        type="button"
        className="detail-back"
        onClick={screen.onCloseInspector}
      >
        <Icon name="chevron-left" /> {screen.screenTitle ?? screen.view.title}
      </button>
      {screen.error === null ? null : (
        <p className="alert workspace-alert detail-alert" role="alert">
          {screen.error}
        </p>
      )}
      {screen.inspector}
    </section>
  );
}

export function WorkspaceScreen(props: WorkspaceScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [localBrowse, setLocalBrowse] = useState(false);
  const browseActive = props.browseActive ?? localBrowse;
  const canWrite = props.canWrite ?? true;
  const activeId = props.selected?.id ?? null;
  const onCapture = props.onCapture ?? focusCompose;
  const onOpenSearch = props.onOpenSearch ?? focusSearch;
  const nav = {
    data: props.data,
    destination: props.destination,
    destinationHref: props.destinationHref,
    extraNavigation: props.extraNavigation,
    inboxCount: inboxTasks(props.data, "").length,
    todayCount: todayGroups(props.data, "", props.today, props.timeZone).reduce(
      (sum, group) => sum + group.tasks.length,
      0,
    ),
    onDestination: (destination: Destination) => {
      setLocalBrowse(false);
      props.onDestination(destination);
    },
  };
  const footer = {
    status: props.status,
    error: props.error,
    onSignOut: props.onSignOut,
  };
  const { detailRef, listRef } = useInspectorFocus(activeId, headingRef);
  useWorkspaceShortcuts({ canWrite, onCapture, onOpenSearch });
  const openBrowse =
    props.onBrowse ??
    (() => {
      setLocalBrowse(true);
    });

  return (
    <div className={`shell${activeId === null ? "" : " has-inspector"}`}>
      <a
        className="skip visually-hidden"
        href={activeId === null ? "#workspace-content" : "#task-detail"}
      >
        Skip to content
      </a>
      <p className="visually-hidden" role="status">
        {props.status ?? ""}
      </p>
      <aside className="sidebar">
        <SidebarFrame
          {...nav}
          {...footer}
          search={props.search}
          canWrite={canWrite}
          onSearch={props.onSearch}
          onOpenSearch={props.onOpenSearch}
          onCompose={onCapture}
        />
      </aside>
      <main className="workspace">
        <WorkspacePanel
          screen={props}
          browseActive={browseActive}
          canWrite={canWrite}
          nav={nav}
          footer={footer}
          listRef={listRef}
          headingRef={headingRef}
          openBrowse={openBrowse}
        />
        {props.selected === null ? null : (
          <WorkspaceInspector screen={props} detailRef={detailRef} />
        )}
      </main>
      {canWrite ? (
        <button
          type="button"
          className="capture"
          aria-label="Quick Add Task"
          onClick={onCapture}
        >
          <Icon name="plus" />
        </button>
      ) : null}
      <MobileTabBar
        {...nav}
        browseActive={browseActive}
        browseHref={props.browseHref}
        onBrowse={openBrowse}
      />
      {props.capture}
    </div>
  );
}
