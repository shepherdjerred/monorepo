import {
  Priority,
  type Label,
  type Project,
  type Task,
} from "@shepherdjerred/facet-protocol";
import { useId, useState } from "react";
import {
  addDays,
  compareCivilDays,
  effectiveCivilDay,
  formatMonthDay,
  type CivilDay,
} from "./civil-day.ts";
import { Icon } from "./icons.tsx";
import { subtaskCount, swatchColor, type WorkspaceView } from "./workspace.ts";

export function QuickAdd(props: { onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  const labelId = useId();
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
        placeholder="Add task"
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
      {dueLabel(props.due, props.today)}
      {overdue ? <span className="visually-hidden">, overdue</span> : null}
    </span>
  );
}

function TaskMeta(props: {
  task: Task;
  tasks: Task[];
  projects: readonly Project[];
  labels: readonly Label[];
  due: CivilDay | undefined;
  today: CivilDay;
  showDue: boolean;
}) {
  const children = subtaskCount(props.tasks, props.task.id);
  const project = props.projects.find(
    (item) => item.id === props.task.project_id && !item.is_inbox,
  );
  const labels = props.labels.filter((label) =>
    props.task.label_ids.includes(label.id),
  );
  const visible =
    props.showDue || children > 0 || labels.length > 0 || project !== undefined;
  if (!visible) return null;
  return (
    <span className="task-meta">
      {props.showDue && props.due !== undefined ? (
        <DueBadge
          due={props.due}
          today={props.today}
          completed={props.task.completed}
        />
      ) : null}
      {children === 0 ? null : (
        <span>
          {children.toString()} {children === 1 ? "subtask" : "subtasks"}
        </span>
      )}
      {labels.map((label) => (
        <span
          key={label.id}
          className="task-label"
          style={
            swatchColor(label.color) === undefined
              ? undefined
              : { color: swatchColor(label.color) }
          }
        >
          @{label.name}
        </span>
      ))}
      {project === undefined ? null : (
        <span className="task-project">
          {swatchColor(project.color) === undefined ? null : (
            <span
              className="swatch"
              style={{ background: swatchColor(project.color) }}
            />
          )}
          {project.name}
        </span>
      )}
    </span>
  );
}

function TaskRow(props: {
  task: Task;
  tasks: Task[];
  projects: readonly Project[];
  labels: readonly Label[];
  viewTitle: string;
  selected: boolean;
  timeZone: string;
  today: CivilDay;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
}) {
  const due = effectiveCivilDay(props.task, props.timeZone);
  const showDue =
    due !== undefined &&
    !(props.viewTitle === "Today" && due === props.today) &&
    props.viewTitle !== "Upcoming";
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
          onChange={() => {
            props.onToggle(props.task);
          }}
        />
        <span className="visually-hidden">
          {action} {props.task.title}
        </span>
      </label>
      <button
        type="button"
        className="task-open"
        onClick={() => {
          props.onOpen(props.task);
        }}
      >
        <span className="task-line">
          <span className="task-title">{props.task.title}</span>
          {props.task.priority === Priority.P4 ? null : (
            <span className="priority-pill">{props.task.priority}</span>
          )}
        </span>
        {props.task.description.trim() === "" ? null : (
          <span className="task-description">{props.task.description}</span>
        )}
        <TaskMeta
          task={props.task}
          tasks={props.tasks}
          projects={props.projects}
          labels={props.labels}
          due={due}
          today={props.today}
          showDue={showDue}
        />
      </button>
    </li>
  );
}

export function TaskList(props: {
  view: WorkspaceView;
  tasks: Task[];
  projects?: readonly Project[];
  labels?: readonly Label[];
  selectedId?: string;
  timeZone: string;
  today: CivilDay;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
}) {
  return (
    <div id="tasks">
      {props.view.groups.map((group) => (
        <section
          key={group.id}
          className={group.overdue ? "group overdue" : "group"}
        >
          {group.title === props.view.title ? null : (
            <h2
              id={
                group.civilDate === undefined
                  ? undefined
                  : `day-${group.civilDate}`
              }
            >
              {group.title}
            </h2>
          )}
          {group.tasks.length === 0 ? (
            group.id === "today" ||
            group.id === "inbox" ||
            group.id === "completed" ? (
              <p className="empty">
                {group.id === "today"
                  ? "Nothing due today."
                  : group.id === "inbox"
                    ? "Inbox is clear."
                    : "Nothing completed."}
              </p>
            ) : null
          ) : (
            <ul className="tasks">
              {group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  tasks={props.tasks}
                  projects={props.projects ?? []}
                  labels={props.labels ?? []}
                  viewTitle={props.view.title}
                  selected={props.selectedId === task.id}
                  timeZone={props.timeZone}
                  today={props.today}
                  onToggle={props.onToggle}
                  onOpen={props.onOpen}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
