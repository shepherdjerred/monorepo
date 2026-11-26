import type { Task } from "@shepherdjerred/facet-protocol";
import { useEffect, useId, useRef, useState } from "react";
import type { CivilDay } from "./civil-day.ts";
import { InspectorForm, type TaskDraft } from "./inspector.tsx";
import { bindLightDismiss } from "./light-dismiss.ts";
import { SidebarNav } from "./sidebar.tsx";
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
  const searchId = useId();
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
  const sidebar = (
    <SidebarNav
      data={props.data}
      destination={props.destination}
      inboxCount={inboxCount}
      todayCount={todayCount}
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
      <aside className="sidebar">
        <p className="brand">TaskNotes</p>
        {sidebar}
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            type="button"
            className="menu-button"
            aria-expanded={menuOpen}
            aria-controls="workspace-menu"
            onClick={() => {
              setMenuOpen(true);
              menuRef.current?.showModal();
            }}
          >
            Menu
          </button>
          <h1>{props.view.title}</h1>
          <form
            className="search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <label htmlFor={searchId}>Search</label>
            <input
              id={searchId}
              type="search"
              value={props.search}
              onChange={(event) => {
                props.onSearch(event.target.value);
              }}
            />
          </form>
          <button type="button" className="secondary" onClick={props.onRefresh}>
            Sync
          </button>
          <button type="button" className="secondary" onClick={props.onSignOut}>
            Sign out
          </button>
        </header>
        <main className="list-panel">
          <p className="status" role="status">
            {props.status ?? ""}
          </p>
          {props.error === null ? null : (
            <p className="alert" role="alert">
              {props.error}
            </p>
          )}
          <QuickAdd onAdd={props.onAdd} />
          {props.view.week.length === 0 ? null : (
            <nav className="week" aria-label="Upcoming days">
              <button
                type="button"
                disabled={props.upcomingOffset === 0}
                onClick={() => {
                  props.onUpcomingOffset(Math.max(0, props.upcomingOffset - 7));
                }}
              >
                Previous week
              </button>
              {props.view.week.map((day) => (
                <a key={day.civilDate} href={`#day-${day.civilDate}`}>
                  <span>{day.weekdayShort}</span>
                  <span className="day-number">{day.dayNumber}</span>
                  <span className="visually-hidden">
                    {day.taskCount.toString()} tasks
                  </span>
                </a>
              ))}
              <button
                type="button"
                onClick={() => {
                  props.onUpcomingOffset(props.upcomingOffset + 7);
                }}
              >
                Next week
              </button>
            </nav>
          )}
          <TaskList
            view={props.view}
            tasks={props.data.tasks}
            timeZone={props.timeZone}
            today={props.today}
            onToggle={props.onToggle}
            onOpen={props.onOpen}
          />
        </main>
      </div>
      <dialog
        id="workspace-menu"
        aria-label="Workspace"
        ref={menuRef}
        onClose={() => {
          setMenuOpen(false);
        }}
      >
        <div className="sheet">
          <button
            type="button"
            className="secondary"
            onClick={() => menuRef.current?.close()}
          >
            Close
          </button>
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
