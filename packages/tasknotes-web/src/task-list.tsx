import type { Task } from "@shepherdjerred/facet-protocol";
import { useId, useState } from "react";
import { effectiveCivilDay, type CivilDay } from "./civil-day.ts";
import { subtaskCount, type WorkspaceView } from "./workspace.ts";

export function QuickAdd(props: { onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  const labelId = useId();
  const inputId = useId();
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
      <label id={labelId} htmlFor={inputId}>
        New task
      </label>
      <input
        id={inputId}
        name="title"
        type="text"
        required
        enterKeyHint="done"
        autoComplete="off"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
      />
      <button className="primary" type="submit">
        Add
      </button>
    </form>
  );
}

function TaskRow(props: {
  task: Task;
  tasks: Task[];
  timeZone: string;
  today: CivilDay;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
}) {
  const due = effectiveCivilDay(props.task, props.timeZone);
  const overdue =
    due !== undefined && due < props.today && !props.task.completed;
  const children = subtaskCount(props.tasks, props.task.id);
  const meta: string[] = [props.task.priority];
  if (due !== undefined) meta.push(due);
  if (overdue) meta.push("Overdue");
  if (children > 0) meta.push(`${children.toString()} subtasks`);
  const action = props.task.completed ? "Reopen" : "Complete";
  return (
    <li className="task">
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
        <span className="task-title">{props.task.title}</span>
        <span className="task-meta">{meta.join(" · ")}</span>
      </button>
    </li>
  );
}

export function TaskList(props: {
  view: WorkspaceView;
  tasks: Task[];
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
