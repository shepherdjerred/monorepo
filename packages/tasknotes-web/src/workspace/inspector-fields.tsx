import {
  Priority,
  RecurrenceBasis,
  type Label,
  type Project,
} from "@shepherdjerred/facet-protocol";
import { useState, type Dispatch, type SetStateAction } from "react";
import { addDays, type CivilDay } from "./civil-day.ts";
import { RepeatBuilder } from "./repeat-builder.tsx";
import type { WorkspaceData } from "#sync/sync.ts";
import { readPriority, type TaskDraft } from "./task-draft.ts";
import type { CommandHandler } from "./workspace-commands.ts";
import { sectionsIn } from "./workspace.ts";

type SetDraft = Dispatch<SetStateAction<TaskDraft>>;
type FieldsProps = {
  draft: TaskDraft;
  setDraft: SetDraft;
  today: CivilDay;
  disabled: boolean;
};

export function ScheduleFields({
  draft,
  setDraft,
  today,
  disabled,
}: FieldsProps) {
  return (
    <fieldset className="feature-form" disabled={disabled}>
      <legend>Schedule</legend>
      <div className="feature-fields">
        <label>
          Scheduled date
          <input
            type="date"
            name="due"
            value={draft.dueDate}
            onChange={(event) => {
              const dueDate = event.target.value;
              setDraft((current) => ({
                ...current,
                dueDate,
                ...(dueDate === "" ? { dueTime: "" } : {}),
              }));
            }}
          />
        </label>
        <label>
          Time
          <input
            type="time"
            name="due-time"
            value={draft.dueTime}
            disabled={draft.dueDate === ""}
            onChange={(event) => {
              setDraft({ ...draft, dueTime: event.target.value });
            }}
          />
        </label>
        <label>
          Deadline
          <input
            type="date"
            name="deadline"
            value={draft.deadline}
            onChange={(event) => {
              setDraft({ ...draft, deadline: event.target.value });
            }}
          />
        </label>
      </div>
      <div className="feature-chips" aria-label="Schedule shortcuts">
        <button
          type="button"
          className="feature-chip"
          onClick={() => {
            setDraft({ ...draft, dueDate: today });
          }}
        >
          Today
        </button>
        <button
          type="button"
          className="feature-chip"
          onClick={() => {
            setDraft({ ...draft, dueDate: addDays(today, 1) });
          }}
        >
          Tomorrow
        </button>
        <button
          type="button"
          className="feature-chip"
          onClick={() => {
            setDraft({ ...draft, dueDate: "", dueTime: "" });
          }}
        >
          Clear schedule
        </button>
      </div>
      <RecurrenceFields draft={draft} setDraft={setDraft} today={today} />
    </fieldset>
  );
}

const basicRules = new Set([
  "FREQ=DAILY",
  "FREQ=WEEKLY",
  "FREQ=MONTHLY",
  "FREQ=YEARLY",
]);
function RecurrenceFields({
  draft,
  setDraft,
  today,
}: Pick<FieldsProps, "draft" | "setDraft" | "today">) {
  const [custom, setCustom] = useState(
    draft.recurrenceRule !== "" && !basicRules.has(draft.recurrenceRule),
  );
  return (
    <div className="feature-form">
      <div className="feature-fields">
        <label>
          Repeat
          <select
            value={custom ? "custom" : draft.recurrenceRule}
            onChange={(event) => {
              const rule = event.target.value;
              setCustom(rule === "custom");
              if (rule !== "custom")
                setDraft({ ...draft, recurrenceRule: rule });
              else if (draft.recurrenceRule === "")
                setDraft({ ...draft, recurrenceRule: "FREQ=WEEKLY" });
            }}
          >
            <option value="">Doesn’t repeat</option>
            <option value="FREQ=DAILY">Daily</option>
            <option value="FREQ=WEEKLY">Weekly</option>
            <option value="FREQ=MONTHLY">Monthly</option>
            <option value="FREQ=YEARLY">Yearly</option>
            <option value="custom">Custom rule</option>
          </select>
        </label>
        {draft.recurrenceRule === "" ? null : (
          <label>
            Repeat from
            <select
              value={draft.recurrenceBasis}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  recurrenceBasis:
                    event.target.value === RecurrenceBasis.Completion.toString()
                      ? RecurrenceBasis.Completion
                      : RecurrenceBasis.Scheduled,
                });
              }}
            >
              <option value={RecurrenceBasis.Scheduled}>Scheduled date</option>
              <option value={RecurrenceBasis.Completion}>
                Completion date
              </option>
            </select>
          </label>
        )}
      </div>
      {custom ? (
        <RepeatBuilder
          rule={draft.recurrenceRule}
          dueDate={draft.dueDate === "" ? today : draft.dueDate}
          onChange={(recurrenceRule) => {
            setDraft({ ...draft, recurrenceRule });
          }}
        />
      ) : null}
      {custom ? (
        <label>
          Recurrence rule
          <textarea
            rows={2}
            value={draft.recurrenceRule}
            onChange={(event) => {
              setDraft({ ...draft, recurrenceRule: event.target.value });
            }}
            placeholder="FREQ=WEEKLY;BYDAY=MO,WE;COUNT=8"
          />
        </label>
      ) : null}
    </div>
  );
}

function NewLabel({
  labels,
  onCommand,
  onAttach,
}: {
  labels: Label[];
  onCommand: CommandHandler;
  onAttach: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  async function attach() {
    const title = name.trim();
    if (pending || title === "") return;
    setPending(true);
    try {
      const found = labels.find(
        (label) => label.name.toLowerCase() === title.toLowerCase(),
      );
      const id = found?.id ?? `tmp-${crypto.randomUUID()}`;
      if (
        found !== undefined ||
        (await onCommand(
          { type: "LabelAdd", args: { name: title } },
          { tempId: id },
        ))
      ) {
        onAttach(id);
        setName("");
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <details className="feature-disclosure">
      <summary>Add a label</summary>
      <div className="feature-fields">
        <label>
          Label name
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void attach();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="secondary"
          disabled={pending || name.trim() === ""}
          onClick={() => void attach()}
        >
          Add label
        </button>
      </div>
    </details>
  );
}

export function OrganizationFields({
  props,
  draft,
  setDraft,
  disabled,
}: {
  props: {
    projects: Project[];
    labels: Label[];
    data?: WorkspaceData;
    onCommand?: CommandHandler;
  };
  draft: TaskDraft;
  setDraft: SetDraft;
  disabled: boolean;
}) {
  const sections =
    props.data === undefined ? [] : sectionsIn(props.data, draft.projectId);
  return (
    <fieldset className="feature-form" disabled={disabled}>
      <legend>Organize</legend>
      <div className="feature-fields">
        <label>
          Project
          <select
            name="project"
            value={draft.projectId}
            onChange={(event) => {
              setDraft({
                ...draft,
                projectId: event.target.value,
                sectionId: "",
              });
            }}
          >
            {draft.projectId === "" ||
            !props.projects.some((project) => project.is_inbox) ? (
              <option value="">Inbox</option>
            ) : null}
            {props.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Section
          <select
            name="section"
            value={draft.sectionId}
            onChange={(event) => {
              setDraft({ ...draft, sectionId: event.target.value });
            }}
          >
            <option value="">No section</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            name="priority"
            value={draft.priority}
            onChange={(event) => {
              const priority = readPriority(event.target.value);
              if (priority !== undefined) setDraft({ ...draft, priority });
            }}
          >
            <option value={Priority.P1}>Priority 1</option>
            <option value={Priority.P2}>Priority 2</option>
            <option value={Priority.P3}>Priority 3</option>
            <option value={Priority.P4}>No priority</option>
          </select>
        </label>
      </div>
      <div className="feature-chips" aria-label="Labels">
        {props.labels.map((label) => (
          <label className="feature-check" key={label.id}>
            <input
              type="checkbox"
              checked={draft.labelIds.includes(label.id)}
              onChange={(event) => {
                const checked = event.target.checked;
                setDraft((current) => ({
                  ...current,
                  labelIds: checked
                    ? [...current.labelIds, label.id]
                    : current.labelIds.filter((id) => id !== label.id),
                }));
              }}
            />
            {label.name}
          </label>
        ))}
      </div>
      {disabled || props.onCommand === undefined ? null : (
        <NewLabel
          labels={props.labels}
          onCommand={props.onCommand}
          onAttach={(id) => {
            setDraft((current) =>
              current.labelIds.includes(id)
                ? current
                : { ...current, labelIds: [...current.labelIds, id] },
            );
          }}
        />
      )}
    </fieldset>
  );
}
