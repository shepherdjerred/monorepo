import type { Project } from "@shepherdjerred/facet-protocol";
import { useState } from "react";
import type { WorkspaceData } from "#sync/sync.ts";
import { TaskOrderButtons } from "./task-order.tsx";
import { moveTaskTrees, type CommandHandler } from "./workspace-commands.ts";
import { activeProjects, projectGroups, sectionsIn } from "./workspace.ts";

function projectAvailableTasks(data: WorkspaceData, projectId: string) {
  return data.tasks.filter(
    (task) =>
      task.project_id === projectId &&
      !task.is_deleted &&
      !task.completed &&
      (task.parent_id ?? "") === "",
  );
}

export function BatchMove({
  data,
  project,
  onCommand,
}: {
  data: WorkspaceData;
  project: Project;
  onCommand: CommandHandler;
}) {
  const available = projectAvailableTasks(data, project.id);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState(project.id);
  const [section, setSection] = useState("");
  const [busy, setBusy] = useState(false);
  const projects = activeProjects(data.projects);

  async function submit() {
    if (busy || selected.size === 0) return;
    setBusy(true);
    try {
      const tasks = moveTaskTrees(data.tasks, [...selected], target, section);
      if (
        tasks.length > 0 &&
        (await onCommand(
          { type: "TaskMove", args: { tasks } },
          {
            notice: `Moved ${selected.size.toString()} ${selected.size === 1 ? "task" : "tasks"}`,
          },
        ))
      )
        setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  return available.length === 0 ? null : (
    <details className="feature-disclosure">
      <summary>Move multiple tasks</summary>
      <form
        className="feature-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset className="feature-form">
          <legend>Select tasks</legend>
          {available.map((task) => (
            <label key={task.id} className="feature-check">
              <input
                type="checkbox"
                checked={selected.has(task.id)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(task.id);
                  else next.delete(task.id);
                  setSelected(next);
                }}
              />
              {task.title}
            </label>
          ))}
        </fieldset>
        <div className="feature-fields">
          <label>
            Move to project
            <select
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
                setSection("");
              }}
            >
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Move to section
            <select
              value={section}
              onChange={(event) => {
                setSection(event.target.value);
              }}
            >
              <option value="">No section</option>
              {sectionsIn(data, target).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="submit"
          className="primary"
          disabled={busy || selected.size === 0}
        >
          {busy ? "Moving…" : "Move tasks"}
        </button>
      </form>
    </details>
  );
}

export function ProjectTaskOrdering({
  data,
  projectId,
  onCommand,
}: {
  data: WorkspaceData;
  projectId: string;
  onCommand: CommandHandler;
}) {
  const groups = projectGroups(data, projectId, "").filter(
    (group) => group.tasks.length > 1,
  );
  if (groups.length === 0) return null;
  return (
    <details className="feature-disclosure">
      <summary>Reorder tasks</summary>
      {groups.map((group) => (
        <section key={group.id}>
          <h3>{group.title}</h3>
          <ol>
            {group.tasks.map((task, position) => (
              <li key={task.id}>
                <strong>{task.title}</strong>
                <TaskOrderButtons
                  tasks={group.tasks}
                  position={position}
                  onCommand={onCommand}
                />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </details>
  );
}
