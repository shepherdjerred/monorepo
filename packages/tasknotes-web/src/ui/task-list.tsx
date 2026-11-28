import {
  Priority,
  type Label,
  type Project,
  type Task,
} from "@shepherdjerred/facet-protocol";
import { useId, useState, type ReactNode } from "react";
import {
  addDays,
  compareCivilDays,
  effectiveCivilDay,
  formatMonthDay,
  type CivilDay,
} from "#workspace/civil-day.ts";
import { Icon } from "./icons.tsx";
import { WorkspaceLink } from "./sidebar.tsx";
import {
  swatchColor,
  type TaskGroup,
  type WorkspaceView,
} from "#workspace/workspace.ts";

export function QuickAdd(props: {
  onAdd: (title: string) => void;
  onCapture?: (() => void) | undefined;
}) {
  const [title, setTitle] = useState("");
  const labelId = useId();
  if (props.onCapture !== undefined) {
    return (
      <button className="inline-add" type="button" onClick={props.onCapture}>
        <Icon name="plus" /> Add task
      </button>
    );
  }
  return (
    <form
      className="quick-add"
      aria-labelledby={labelId}
      onSubmit={(event) => {
        event.preventDefault();
        const next = title.trim();
        if (next === "") return;
        props.onAdd(next);
        setTitle("");
      }}
    >
      <Icon name="plus" />
      <label id={labelId} className="visually-hidden" htmlFor="quick-add-field">
        New task
      </label>
      <input
        id="quick-add-field"
        name="title"
        type="text"
        required
        enterKeyHint="done"
        autoComplete="off"
        placeholder="Add a task…"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
      />
      {title.trim() === "" ? null : (
        <button className="primary" type="submit">
          Add
        </button>
      )}
    </form>
  );
}

function dueLabel(due: CivilDay, today: CivilDay): string {
  if (due === today) return "Today";
  if (due === addDays(today, 1)) return "Tomorrow";
  return due === addDays(today, -1) ? "Yesterday" : formatMonthDay(due);
}

function DueBadge(props: {
  due: CivilDay;
  today: CivilDay;
  completed: boolean;
}) {
  const overdue =
    !props.completed && compareCivilDays(props.due, props.today) < 0;
  const tone = overdue
    ? "overdue"
    : props.due === props.today
      ? "today"
      : "scheduled";
  return (
    <span className={`due due-${tone}`}>
      <Icon name="calendar" />
      <time dateTime={props.due}>{dueLabel(props.due, props.today)}</time>
      {overdue ? <span className="visually-hidden">, overdue</span> : null}
    </span>
  );
}

function TaskMeta(props: {
  task: Task;
  project: Project | undefined;
  labels: readonly Label[];
  childrenCount: number;
  due: CivilDay | undefined;
  today: CivilDay;
}) {
  const project = props.project?.is_inbox === true ? undefined : props.project;
  if (
    project === undefined &&
    props.due === undefined &&
    props.childrenCount === 0 &&
    props.labels.length === 0 &&
    !props.task.is_recurring
  )
    return null;

  return (
    <span className="task-meta">
      {props.due === undefined ? null : (
        <DueBadge
          due={props.due}
          today={props.today}
          completed={props.task.completed}
        />
      )}
      {props.task.is_recurring ? (
        <span className="task-meta-item">
          <Icon name="repeat" />
          <span className="visually-hidden">Recurring</span>
        </span>
      ) : null}
      {props.childrenCount === 0 ? null : (
        <span className="task-meta-item">
          <Icon name="subtasks" />
          {props.childrenCount}{" "}
          {props.childrenCount === 1 ? "subtask" : "subtasks"}
        </span>
      )}
      {props.labels.map((label) => (
        <span key={label.id} className="task-meta-item task-label">
          <Icon name="tag" />
          {label.name}
        </span>
      ))}
      {project === undefined ? null : (
        <span className="task-meta-item task-project">
          <span
            className="swatch"
            style={{ backgroundColor: swatchColor(project.color) }}
          />
          {project.name}
        </span>
      )}
    </span>
  );
}

function TaskRow(props: {
  task: Task;
  project: Project | undefined;
  labels: readonly Label[];
  childrenCount: number;
  viewTitle: string;
  selected: boolean;
  canWrite: boolean;
  timeZone: string;
  today: CivilDay;
  taskHref: string | undefined;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
}) {
  const due = effectiveCivilDay(props.task, props.timeZone);
  const dueIsInHeading =
    props.viewTitle === "Upcoming" ||
    (props.viewTitle === "Today" && due === props.today);
  const action = props.task.completed ? "Reopen" : "Complete";
  return (
    <li
      className={props.selected ? "task is-selected" : "task"}
      data-priority={props.task.priority}
      data-completed={props.task.completed ? "true" : "false"}
    >
      <label className="complete">
        <input
          type="checkbox"
          checked={props.task.completed}
          disabled={!props.canWrite}
          onChange={() => {
            props.onToggle(props.task);
          }}
        />
        <span className="visually-hidden">
          {action} {props.task.title}
        </span>
      </label>
      <WorkspaceLink
        className="task-open"
        current={props.selected}
        href={props.taskHref}
        taskId={props.task.id}
        onActivate={() => {
          props.onOpen(props.task);
        }}
      >
        <span className="task-line">
          <span className="task-title">{props.task.title}</span>
          {props.task.priority === Priority.P4 ? null : (
            <span
              className="priority-pill"
              title={`Priority ${props.task.priority.slice(1)}`}
            >
              {props.task.priority}
            </span>
          )}
        </span>
        {props.task.description.trim() === "" ? null : (
          <span className="task-description">{props.task.description}</span>
        )}
        <TaskMeta
          task={props.task}
          project={props.project}
          labels={props.labels}
          childrenCount={props.childrenCount}
          due={dueIsInHeading ? undefined : due}
          today={props.today}
        />
        <span className="task-chevron">
          <Icon name="chevron-right" />
        </span>
      </WorkspaceLink>
    </li>
  );
}

function emptyMessage(title: string): string {
  if (title === "Today") return "Nothing due today.";
  if (title === "Inbox") return "Inbox is clear.";
  if (title === "Completed") return "Nothing completed yet.";
  return title === "Upcoming"
    ? "No tasks scheduled in this period."
    : "No tasks in this view yet.";
}

function groupHeadingId(group: TaskGroup): string | undefined {
  return group.civilDate === undefined ? undefined : `day-${group.civilDate}`;
}

export function TaskList(props: {
  view: WorkspaceView;
  tasks: Task[];
  projects?: readonly Project[];
  labels?: readonly Label[];
  selectedId?: string | undefined;
  canWrite?: boolean | undefined;
  timeZone: string;
  today: CivilDay;
  taskHref?: ((task: Task) => string) | undefined;
  groupActions?: ((group: TaskGroup) => ReactNode) | undefined;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
}) {
  const projectById = new Map(
    props.projects?.map((project) => [project.id, project]),
  );
  const labelById = new Map(props.labels?.map((label) => [label.id, label]));
  const childCounts = new Map<string, number>();
  for (const task of props.tasks) {
    if (
      !task.is_deleted &&
      task.parent_id !== undefined &&
      task.parent_id !== ""
    ) {
      childCounts.set(
        task.parent_id,
        (childCounts.get(task.parent_id) ?? 0) + 1,
      );
    }
  }
  const allEmpty = props.view.groups.every((group) => group.tasks.length === 0);
  return (
    <div id="tasks">
      {allEmpty ? (
        <div className="empty">
          <span className="empty-icon">
            <Icon name={props.view.title === "Inbox" ? "tray" : "check"} />
          </span>
          <p>{emptyMessage(props.view.title)}</p>
        </div>
      ) : null}
      {props.view.groups.map((group) => {
        const actions = props.groupActions?.(group);
        const showTitle =
          group.title !== props.view.title &&
          (!allEmpty || actions !== undefined);
        return (
          <section
            key={group.id}
            className={group.overdue ? "group overdue" : "group"}
            id={showTitle ? undefined : groupHeadingId(group)}
          >
            {showTitle || actions !== undefined ? (
              <div className="group-heading">
                {showTitle ? (
                  <h2 id={groupHeadingId(group)}>{group.title}</h2>
                ) : null}
                {actions}
              </div>
            ) : null}
            {group.tasks.length === 0 ? null : (
              <ul className="tasks">
                {group.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    project={projectById.get(task.project_id)}
                    labels={task.label_ids.flatMap(
                      (id) => labelById.get(id) ?? [],
                    )}
                    childrenCount={childCounts.get(task.id) ?? 0}
                    viewTitle={props.view.title}
                    selected={props.selectedId === task.id}
                    canWrite={props.canWrite ?? true}
                    timeZone={props.timeZone}
                    today={props.today}
                    taskHref={props.taskHref?.(task)}
                    onToggle={props.onToggle}
                    onOpen={props.onOpen}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
