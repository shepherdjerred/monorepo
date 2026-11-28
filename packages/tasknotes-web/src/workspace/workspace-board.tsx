import { Priority, type Task } from "@shepherdjerred/facet-protocol";
import { useId, useRef, useState } from "react";
import { addDays, isCivilDay, type CivilDay } from "./civil-day.ts";
import { WorkspaceLink } from "#ui/sidebar.tsx";
import { TaskOrderButtons } from "./task-order.tsx";
import { moveTaskSchedule } from "./task-schedule.ts";
import type { WorkspaceData } from "#sync/sync.ts";
import { moveTaskTrees, type CommandHandler } from "./workspace-commands.ts";
import {
  defaultProjectPreferences,
  projectGroups,
  type ProjectPreferences,
} from "./workspace.ts";
import "./workspace-features.css";

type BoardProps = {
  data: WorkspaceData;
  projectId: string;
  preferences?: ProjectPreferences;
  canWrite?: boolean;
  onOpenTask: (task: Task) => void;
  taskHref?: (task: Task) => string;
  onCommand: CommandHandler;
  onToggle: (task: Task) => void;
  onAskDelete?: (task: Task) => void;
};

type Column = {
  id: string;
  title: string;
  tasks: Task[];
  section?: string;
  priority?: Priority;
};
const noSectionId = "no-section";

function boardColumns(props: BoardProps): Column[] {
  const preferences = props.preferences ?? defaultProjectPreferences;
  if (preferences.grouping === "priority") {
    const groups = projectGroups(props.data, props.projectId, "", preferences);
    return Object.values(Priority).map((priority) => ({
      id: priority,
      title:
        priority === Priority.P4
          ? "No priority"
          : `Priority ${priority.slice(1)}`,
      tasks:
        groups.find(
          (group) => group.id === `project.${props.projectId}.${priority}`,
        )?.tasks ?? [],
      priority,
    }));
  }
  const groups = projectGroups(props.data, props.projectId, "", preferences);
  const columns = groups.map((group) => ({
    id: group.sectionId ?? noSectionId,
    title: group.title,
    tasks: group.tasks,
    section: group.sectionId ?? "",
  }));
  return columns.some((group) => group.section === "")
    ? columns
    : [
        { id: noSectionId, title: "No section", tasks: [], section: "" },
        ...columns,
      ];
}

function AddBoardTask({
  column,
  onCommand,
  projectId,
}: {
  column: Column;
  projectId: string;
  onCommand: CommandHandler;
}) {
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const inputId = useId();
  async function submit() {
    if (pending || title.trim() === "") return;
    setPending(true);
    try {
      const accepted = await onCommand(
        {
          type: "TaskAdd",
          args: {
            title: title.trim(),
            project_id: projectId,
            ...((column.section ?? "") === ""
              ? {}
              : { section_id: column.section ?? "" }),
            ...(column.priority === undefined
              ? {}
              : { priority: column.priority }),
          },
        },
        { tempId: `tmp-${crypto.randomUUID()}`, notice: "Added task" },
      );
      if (accepted) setTitle("");
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="feature-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={inputId} className="visually-hidden">
        Add task to {column.title}
      </label>
      <input
        id={inputId}
        value={title}
        placeholder="Add a task…"
        onChange={(event) => {
          setTitle(event.target.value);
        }}
      />
      <button
        type="submit"
        className="secondary"
        disabled={pending || title.trim() === ""}
      >
        Add task
      </button>
    </form>
  );
}

export function WorkspaceBoard(props: BoardProps) {
  const columns = boardColumns(props);
  const dragged = useRef<string | undefined>(undefined);
  const canWrite = props.canWrite !== false;

  function move(task: Task, column: Column) {
    if (column.priority === undefined) {
      const tasks = moveTaskTrees(
        props.data.tasks,
        [task.id],
        props.projectId,
        column.section ?? "",
      );
      void props.onCommand(
        { type: "TaskMove", args: { tasks } },
        { notice: `Moved to ${column.title}` },
      );
    } else {
      void props.onCommand(
        {
          type: "TaskUpdate",
          args: { id: task.id, priority: column.priority },
        },
        { notice: "Changed priority" },
      );
    }
  }

  return (
    <div
      className="feature-board"
      role="region"
      aria-label="Project board"
      tabIndex={0}
    >
      {columns.map((column) => (
        <section
          key={column.id}
          className="feature-board-column"
          onDragOver={(event) => {
            if (canWrite && dragged.current !== undefined)
              event.preventDefault();
          }}
          onDrop={(event) => {
            if (!canWrite || dragged.current === undefined) return;
            event.preventDefault();
            const task = props.data.tasks.find(
              (candidate) => candidate.id === dragged.current,
            );
            if (
              task !== undefined &&
              !column.tasks.some((candidate) => candidate.id === task.id)
            )
              move(task, column);
            dragged.current = undefined;
          }}
        >
          <h2>
            {column.title} <small>{column.tasks.length}</small>
          </h2>
          {column.tasks.length === 0 ? (
            <p className="feature-note">No tasks</p>
          ) : (
            <ul>
              {column.tasks.map((task, position) => (
                <li
                  key={task.id}
                  className="feature-board-card"
                  draggable={canWrite}
                  onDragStart={(event) => {
                    dragged.current = task.id;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", task.id);
                  }}
                  onDragEnd={() => {
                    dragged.current = undefined;
                  }}
                >
                  <WorkspaceLink
                    href={props.taskHref?.(task)}
                    taskId={task.id}
                    onActivate={() => {
                      props.onOpenTask(task);
                    }}
                  >
                    {task.title}
                  </WorkspaceLink>
                  {task.description === "" ? null : (
                    <p className="feature-note">{task.description}</p>
                  )}
                  {task.due_date === undefined ? null : (
                    <small>{task.due_date}</small>
                  )}
                  {canWrite ? (
                    <details className="feature-disclosure">
                      <summary>Task actions</summary>
                      <div className="feature-form">
                        {column.priority === undefined &&
                        (props.preferences?.sort ?? "manual") === "manual" ? (
                          <TaskOrderButtons
                            tasks={column.tasks}
                            position={position}
                            onCommand={props.onCommand}
                          />
                        ) : null}
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => {
                            props.onToggle(task);
                          }}
                        >
                          Complete task
                        </button>
                        {columns.length < 2 ? null : (
                          <label>
                            Move task
                            <select
                              value=""
                              onChange={(event) => {
                                const next = columns.find(
                                  (item) => item.id === event.target.value,
                                );
                                if (next !== undefined) move(task, next);
                              }}
                            >
                              <option value="" disabled>
                                Choose a column
                              </option>
                              {columns
                                .filter((item) => item.id !== column.id)
                                .map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.title}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                        {props.onAskDelete === undefined ? null : (
                          <button
                            className="danger"
                            type="button"
                            onClick={() => props.onAskDelete?.(task)}
                          >
                            Delete task
                          </button>
                        )}
                      </div>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canWrite ? (
            <AddBoardTask
              column={column}
              projectId={props.projectId}
              onCommand={props.onCommand}
            />
          ) : null}
        </section>
      ))}
    </div>
  );
}

export function BulkSchedule({
  tasks,
  timeZone,
  today,
  onCommand,
}: {
  tasks: Task[];
  timeZone: string;
  today: CivilDay;
  onCommand: CommandHandler;
}) {
  const [day, setDay] = useState(today);
  const [busy, setBusy] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  const eligible = tasks.filter((task) => !task.completed && !task.is_deleted);

  async function submit(target: CivilDay) {
    if (busy || eligible.length === 0 || !isCivilDay(target)) return;
    setBusy(true);
    try {
      const count = eligible.length;
      if (
        (await onCommand(
          {
            type: "TaskReschedule",
            args: {
              tasks: eligible.map((task) =>
                moveTaskSchedule(task, target, timeZone),
              ),
            },
          },
          {
            notice:
              count === 1
                ? "Rescheduled task"
                : `Rescheduled ${count.toString()} tasks`,
          },
        )) &&
        details.current !== null
      )
        details.current.open = false;
    } finally {
      setBusy(false);
    }
  }

  return eligible.length === 0 ? null : (
    <details className="feature-disclosure" ref={details}>
      <summary>
        {eligible.length === 1 ? "Reschedule" : "Reschedule group"}
      </summary>
      <form
        className="feature-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(day);
        }}
      >
        <div className="feature-chips">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void submit(today)}
          >
            Today
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void submit(addDays(today, 1))}
          >
            Tomorrow
          </button>
        </div>
        <label>
          New date
          <input
            type="date"
            value={day}
            onChange={(event) => {
              setDay(event.target.value);
            }}
            required
          />
        </label>
        <button
          className="primary"
          type="submit"
          disabled={busy || !isCivilDay(day)}
        >
          {busy ? "Rescheduling…" : "Reschedule"}
        </button>
      </form>
    </details>
  );
}
