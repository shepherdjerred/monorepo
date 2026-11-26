import {
  Priority,
  type Label,
  type Project,
  type Task,
} from "@shepherdjerred/facet-protocol";
import { useId, useState } from "react";
import { addDays, effectiveCivilDay, type CivilDay } from "./civil-day.ts";

export type TaskDraft = {
  title: string;
  description: string;
  priority: Priority;
  dueDate: string;
  projectId: string;
  labelIds: string[];
};

function parsePriority(value: string): Priority {
  if (value === "P1") return Priority.P1;
  if (value === "P2") return Priority.P2;
  if (value === "P3") return Priority.P3;
  if (value === "P4") return Priority.P4;
  throw new Error(`Unknown priority: ${value}`);
}

export function InspectorForm(props: {
  task: Task;
  projects: Project[];
  labels: Label[];
  timeZone: string;
  today: CivilDay;
  onSave: (draft: TaskDraft) => void;
  onClose: () => void;
  onToggle: () => void;
  onAskDelete: () => void;
}) {
  const due = effectiveCivilDay(props.task, props.timeZone) ?? "";
  const [title, setTitle] = useState(props.task.title);
  const [description, setDescription] = useState(props.task.description);
  const [priority, setPriority] = useState(props.task.priority);
  const [dueDate, setDueDate] = useState(due);
  const [projectId, setProjectId] = useState(props.task.project_id);
  const [labelIds, setLabelIds] = useState(props.task.label_ids);
  const titleId = useId();
  const descriptionId = useId();
  const priorityId = useId();
  const dueId = useId();
  const projectIdField = useId();
  const labelPrefix = useId();

  return (
    <div className="sheet inspector">
      <form
        aria-labelledby="inspector-title"
        onSubmit={(event) => {
          event.preventDefault();
          const nextTitle = title.trim();
          if (nextTitle === "") return;
          props.onSave({
            title: nextTitle,
            description,
            priority,
            dueDate,
            projectId,
            labelIds,
          });
        }}
      >
        <div className="inspector-header">
          <button
            type="button"
            className="complete-toggle"
            data-priority={props.task.priority}
            data-completed={props.task.completed ? "true" : "false"}
            aria-label={props.task.completed ? "Reopen task" : "Complete task"}
            onClick={props.onToggle}
          >
            <span />
          </button>
          <h1 id="inspector-title" className="visually-hidden">
            {title.trim() === "" ? "Task" : title}
          </h1>
          <input
            id={titleId}
            className="title-field"
            name="title"
            type="text"
            required
            autoFocus
            aria-label="Task title"
            placeholder="Task title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
          <button type="button" className="text-button" onClick={props.onClose}>
            Done
          </button>
        </div>
        <div className="inspector-columns">
          <div className="inspector-main">
            <div className="field">
              <label htmlFor={descriptionId}>Description</label>
              <textarea
                id={descriptionId}
                name="description"
                value={description}
                placeholder="Add description"
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
              />
            </div>
          </div>
          <div className="inspector-properties">
            <div className="field">
              <label htmlFor={priorityId}>Priority</label>
              <select
                id={priorityId}
                name="priority"
                value={priority}
                onChange={(event) => {
                  setPriority(parsePriority(event.target.value));
                }}
              >
                <option value={Priority.P1}>Priority 1</option>
                <option value={Priority.P2}>Priority 2</option>
                <option value={Priority.P3}>Priority 3</option>
                <option value={Priority.P4}>Priority 4</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={dueId}>Due date</label>
              <input
                id={dueId}
                name="due"
                type="date"
                value={dueDate}
                onChange={(event) => {
                  setDueDate(event.target.value);
                }}
              />
              <div className="choice-row">
                <button
                  type="button"
                  onClick={() => {
                    setDueDate(props.today);
                  }}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDueDate(addDays(props.today, 1));
                  }}
                >
                  Tomorrow
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDueDate("");
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor={projectIdField}>Project</label>
              <select
                id={projectIdField}
                name="project"
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                }}
              >
                {props.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <fieldset>
              <legend>Labels</legend>
              <div className="labels">
                {props.labels.map((label) => {
                  const fieldId = `${labelPrefix}-${label.id}`;
                  const checked = labelIds.includes(label.id);
                  return (
                    <label key={label.id} htmlFor={fieldId}>
                      <input
                        id={fieldId}
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setLabelIds((current) =>
                            checked
                              ? current.filter((id) => id !== label.id)
                              : [...current, label.id],
                          );
                        }}
                      />
                      <span>@{label.name}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
        </div>
        <div className="actions">
          <button className="primary" type="submit">
            Save
          </button>
          <button className="danger" type="button" onClick={props.onAskDelete}>
            Delete
          </button>
        </div>
      </form>
    </div>
  );
}
