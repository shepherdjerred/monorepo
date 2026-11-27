import {
  Priority,
  RecurrenceBasis,
  type TaskAddArgs,
} from "@shepherdjerred/facet-protocol";
import { useId, useRef, useState } from "react";
import { parseCapture, type CaptureContext } from "./capture-parser.ts";
import { isCivilDay } from "./civil-day.ts";
import { readPriority } from "./task-draft.ts";
import { isoForWallTime, wallTimeForIso } from "./task-schedule.ts";
import type { CommandHandler } from "./workspace-commands.ts";
import { activeProjects, sectionsIn } from "./workspace.ts";
import "./workspace-features.css";

function overrideDate(
  args: TaskAddArgs,
  day: string,
  timeZone: string,
): string | undefined {
  if (day === "") {
    if (args.recurrence_rule !== undefined)
      return "Choose a date for a repeating task.";
    delete args.due_date;
    delete args.due_datetime;
    delete args.due_timezone;
  } else {
    if (!isCivilDay(day)) return "Choose a valid date.";
    args.due_date = day;
    args.due_timezone = timeZone;
    if (args.due_datetime !== undefined) {
      args.due_datetime = isoForWallTime(
        day,
        wallTimeForIso(args.due_datetime, timeZone),
        timeZone,
      );
    }
  }
  delete args.due_string;
  return undefined;
}

export function WorkspaceCapture(
  props: CaptureContext & { onCommand: CommandHandler; onClose: () => void },
) {
  const [raw, setRaw] = useState("");
  const [literal, setLiteral] = useState<ReadonlySet<string>>(new Set());
  const [description, setDescription] = useState("");
  const [project, setProject] = useState<string>();
  const [section, setSection] = useState<string>();
  const [priority, setPriority] = useState<Priority>();
  const [day, setDay] = useState<string>();
  const [keepOpen, setKeepOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const capture = parseCapture(raw, props, literal);
  const projects = activeProjects(props.data.projects);
  const effectiveProject = project ?? capture.args.project_id;
  const effectiveSection =
    section ??
    (effectiveProject === capture.args.project_id
      ? capture.args.section_id
      : "") ??
    "";
  const effectiveDay = day ?? capture.args.due_date ?? "";

  async function createTask() {
    if (busy || capture.args.title === "") return;
    setBusy(true);
    setMessage("");
    try {
      const args = {
        ...capture.args,
        project_id: effectiveProject,
        priority: priority ?? capture.args.priority ?? Priority.P4,
      };
      if (effectiveSection === "") delete args.section_id;
      else args.section_id = effectiveSection;
      const validation =
        day === undefined ? undefined : overrideDate(args, day, props.timeZone);
      if (validation !== undefined) {
        setMessage(validation);
        return;
      }
      if (description.trim() !== "") args.description = description.trim();
      const labelIds = [...(args.label_ids ?? [])];
      for (const name of capture.newLabels) {
        const tempId = `tmp-${crypto.randomUUID()}`;
        if (
          !(await props.onCommand(
            { type: "LabelAdd", args: { name } },
            { tempId },
          ))
        )
          return;
        labelIds.push(tempId);
      }
      if (labelIds.length > 0) args.label_ids = labelIds;
      const accepted = await props.onCommand(
        { type: "TaskAdd", args },
        { tempId: `tmp-${crypto.randomUUID()}`, notice: `Added ${args.title}` },
      );
      if (!accepted) return;
      if (!keepOpen) {
        props.onClose();
        return;
      }
      setRaw("");
      setLiteral(new Set());
      setDescription("");
      setMessage(`Added ${args.title}`);
      field.current?.focus();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Couldn’t add this task.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="feature-form feature-capture"
      aria-label="Quick Add"
      onSubmit={(event) => {
        event.preventDefault();
        void createTask();
      }}
    >
      <h2 className="feature-title">Quick Add</h2>
      <div className="field">
        <label htmlFor={titleId}>Task name</label>
        <input
          id={titleId}
          ref={field}
          value={raw}
          autoComplete="off"
          placeholder="Water the plants tomorrow at 9am…"
          required
          onChange={(event) => {
            setRaw(event.target.value);
            setLiteral(
              new Set(
                [...literal].filter((phrase) =>
                  event.target.value.includes(phrase),
                ),
              ),
            );
          }}
        />
      </div>
      {capture.phrases.length === 0 ? null : (
        <div className="feature-chips" aria-label="Recognized phrases">
          {[...new Set(capture.phrases)].map((phrase) => (
            <button
              type="button"
              key={phrase}
              className="feature-chip"
              aria-label={`Keep ${phrase} in task name`}
              onClick={() => {
                setLiteral((values) => new Set([...values, phrase]));
              }}
            >
              {phrase} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      {capture.unresolvedProject === undefined ? null : (
        <p className="feature-note">
          Couldn’t find {capture.unresolvedProject}. Choose a project below.
        </p>
      )}
      {capture.args.recurrence_rule === undefined ? null : (
        <p className="feature-note">
          Repeats{" "}
          {capture.args.recurrence_basis === RecurrenceBasis.Completion
            ? "from completion"
            : "from the scheduled date"}
        </p>
      )}
      <div className="feature-fields">
        <label>
          Project
          <select
            value={effectiveProject}
            onChange={(event) => {
              setProject(event.target.value);
              setSection("");
            }}
          >
            {projects.some((option) => option.is_inbox) ? null : (
              <option value="">Inbox</option>
            )}
            {projects.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Section
          <select
            value={effectiveSection}
            onChange={(event) => {
              setSection(event.target.value);
            }}
          >
            <option value="">No section</option>
            {sectionsIn(props.data, effectiveProject).map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input
            type="date"
            value={effectiveDay}
            onChange={(event) => {
              setDay(event.target.value);
            }}
          />
        </label>
        <label>
          Priority
          <select
            value={priority ?? capture.args.priority}
            onChange={(event) => {
              const next = readPriority(event.target.value);
              if (next !== undefined) setPriority(next);
            }}
          >
            <option value={Priority.P4}>No priority</option>
            <option value={Priority.P1}>Priority 1</option>
            <option value={Priority.P2}>Priority 2</option>
            <option value={Priority.P3}>Priority 3</option>
          </select>
        </label>
      </div>
      <details className="feature-disclosure">
        <summary>Add a description</summary>
        <label className="visually-hidden" htmlFor={descriptionId}>
          Description
        </label>
        <textarea
          id={descriptionId}
          rows={3}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </details>
      <div className="feature-actions">
        <label className="feature-check">
          <input
            type="checkbox"
            checked={keepOpen}
            onChange={(event) => {
              setKeepOpen(event.target.checked);
            }}
          />{" "}
          Keep adding tasks
        </label>
        <button
          type="button"
          className="secondary"
          onClick={props.onClose}
          disabled={busy}
        >
          Close
        </button>
        <button
          type="submit"
          className="primary"
          disabled={busy || capture.args.title === ""}
        >
          {busy ? "Adding…" : "Add Task"}
        </button>
      </div>
      {message === "" ? null : (
        <p className="feature-note" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
