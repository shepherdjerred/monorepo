import type { Task } from "@shepherdjerred/facet-protocol";
import { useEffect, useRef, useState } from "react";
import type { CivilDay } from "./civil-day.ts";
import { Icon } from "./icons.tsx";
import { InspectorForm, type TaskDraft } from "./inspector.tsx";
import { bindLightDismiss } from "./light-dismiss.ts";
import { MobileTabBar, SearchForm, SidebarFrame } from "./sidebar.tsx";
import type { WorkspaceData } from "./sync.ts";
import { QuickAdd, TaskList } from "./task-list.tsx";
import {
  activeLabels,
  activeProjects,
  inboxTasks,
  todayGroups,
  type Destination,
  type WorkspaceView,
} from "./workspace.ts";

function focusCompose(): void {
  const field = document.querySelector("#quick-add-field");
  if (!(field instanceof HTMLInputElement)) {
    return;
  }
  field.scrollIntoView({ block: "nearest" });
  field.focus();
}

export function WorkspaceScreen(props: {
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
  onSave: (draft: TaskDraft) => void;
  onDelete: (task: Task) => void;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const menuRef = useRef<HTMLDialogElement>(null);
  const inspectorRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const inboxCount = inboxTasks(props.data, props.search).length;
  const todayCount = todayGroups(
    props.data,
    props.search,
    props.today,
    props.timeZone,
  ).reduce((sum, group) => sum + group.tasks.length, 0);

  useEffect(() => {
    const dialogs = [menuRef.current, inspectorRef.current, confirmRef.current];
    const cleanups = dialogs.flatMap((dialog) =>
      dialog === null ? [] : [bindLightDismiss(dialog)],
    );
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  useEffect(() => {
    const dialog = inspectorRef.current;
    if (dialog === null) return;
    if (props.selected === null) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
  }, [props.selected]);

  const projects = activeProjects(props.data.projects);
  const labels = activeLabels(props.data.labels);
  const taskCount = props.view.groups.reduce(
    (sum, group) => sum + group.tasks.length,
    0,
  );
  const openBrowse = () => {
    setMenuOpen(true);
    menuRef.current?.showModal();
  };
  const sidebar = (
    <SidebarFrame
      data={props.data}
      destination={props.destination}
      inboxCount={inboxCount}
      todayCount={todayCount}
      search={props.search}
      status={props.status}
      error={props.error}
      onSearch={props.onSearch}
      onCompose={() => {
        if (menuRef.current?.open === true) {
          menuRef.current.close();
        }
        focusCompose();
      }}
      onSignOut={props.onSignOut}
      onDestination={(destination) => {
        props.onDestination(destination);
        menuRef.current?.close();
      }}
    />
  );

  return (
    <div className="shell">
      <a className="skip visually-hidden" href="#tasks">
        Skip to tasks
      </a>
      <p className="visually-hidden" role="status">
        {props.status ?? ""}
      </p>
      <aside className="sidebar">{sidebar}</aside>
      <div className="workspace">
        <main className="list-panel">
          <div className="list-column">
            <header className="list-heading">
              <h1>{props.view.title}</h1>
              <p className="task-count">
                {taskCount === 1 ? "1 task" : `${taskCount.toString()} tasks`}
              </p>
              <button
                type="button"
                className="sync-button"
                onClick={props.onRefresh}
              >
                <Icon name="sync" />
                Sync
              </button>
              <SearchForm
                className="header-search"
                value={props.search}
                onSearch={props.onSearch}
              />
            </header>
            {props.error === null ? null : (
              <p className="alert" role="alert">
                {props.error}
              </p>
            )}
            {props.view.week.length === 0 ? null : (
              <>
                <div className="week-nav">
                  <button
                    type="button"
                    className="text-button"
                    disabled={props.upcomingOffset === 0}
                    onClick={() => {
                      props.onUpcomingOffset(
                        Math.max(0, props.upcomingOffset - 7),
                      );
                    }}
                  >
                    Previous week
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      props.onUpcomingOffset(props.upcomingOffset + 7);
                    }}
                  >
                    Next week
                  </button>
                </div>
                <nav className="week" aria-label="Upcoming days">
                  {props.view.week.map((day) => (
                    <a
                      key={day.civilDate}
                      href={`#day-${day.civilDate}`}
                      className={day.taskCount > 0 ? "has-tasks" : undefined}
                    >
                      <span>{day.weekdayShort}</span>
                      <span className="day-number">{day.dayNumber}</span>
                      <span className="day-dot" />
                      <span className="visually-hidden">
                        {day.taskCount.toString()} tasks
                      </span>
                    </a>
                  ))}
                </nav>
              </>
            )}
            <TaskList
              view={props.view}
              tasks={props.data.tasks}
              projects={projects}
              labels={labels}
              {...(props.selected === null
                ? {}
                : { selectedId: props.selected.id })}
              timeZone={props.timeZone}
              today={props.today}
              onToggle={props.onToggle}
              onOpen={props.onOpen}
            />
            <QuickAdd onAdd={props.onAdd} />
          </div>
        </main>
      </div>
      <button type="button" className="capture" onClick={focusCompose}>
        <Icon name="plus" />
        <span className="visually-hidden">Quick Add Task</span>
      </button>
      <MobileTabBar
        destination={props.destination}
        menuOpen={menuOpen}
        onDestination={props.onDestination}
        onBrowse={openBrowse}
      />
      <dialog
        id="workspace-menu"
        aria-labelledby="browse-title"
        ref={menuRef}
        onClose={() => {
          setMenuOpen(false);
        }}
      >
        <div className="sheet browse-sheet">
          <div className="inspector-toolbar">
            <h1 id="browse-title">Browse</h1>
            <button
              type="button"
              className="text-button"
              onClick={() => menuRef.current?.close()}
            >
              Close
            </button>
          </div>
          {sidebar}
        </div>
      </dialog>
      <dialog
        aria-labelledby="inspector-title"
        ref={inspectorRef}
        onClose={props.onCloseInspector}
      >
        {props.selected === null ? (
          <div className="sheet">
            <h1 id="inspector-title">Task</h1>
          </div>
        ) : (
          <InspectorForm
            key={`${props.selected.id}:${props.selected.updated_at}`}
            task={props.selected}
            projects={projects}
            labels={labels}
            timeZone={props.timeZone}
            today={props.today}
            onSave={props.onSave}
            onClose={() => inspectorRef.current?.close()}
            onToggle={() => {
              if (props.selected !== null) {
                props.onToggle(props.selected);
              }
            }}
            onAskDelete={() => confirmRef.current?.showModal()}
          />
        )}
      </dialog>
      <dialog
        aria-labelledby="delete-title"
        ref={confirmRef}
        onClose={(event) => {
          const dialog = event.currentTarget;
          if (dialog.returnValue === "delete" && props.selected !== null) {
            props.onDelete(props.selected);
          }
          dialog.returnValue = "";
        }}
      >
        <div className="sheet">
          <h1 id="delete-title">Delete this task?</h1>
          <p>
            {props.selected === null ? "This task" : props.selected.title} is
            removed from your lists.
          </p>
          <form method="dialog" className="actions">
            <button className="secondary" type="submit" value="cancel">
              Cancel
            </button>
            <button className="danger" type="submit" value="delete">
              Delete
            </button>
          </form>
        </div>
      </dialog>
    </div>
  );
}
