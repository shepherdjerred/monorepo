import {
  type Label,
  type Project,
  type Task,
} from "@shepherdjerred/facet-protocol";
import { lazy, Suspense, useEffect, useId, useState } from "react";
import type { CivilDay } from "./civil-day.ts";
import { OrganizationFields, ScheduleFields } from "./inspector-fields.tsx";
import { TaskDiscussion } from "./task-discussion.tsx";
import { taskDraft, type TaskDraft } from "./task-draft.ts";
import type { WorkspaceData } from "#sync/sync.ts";
import { moveTaskTrees, type CommandHandler } from "./workspace-commands.ts";
import "./workspace-features.css";

const MarkdownPreview = lazy(async () => {
  const { TaskMarkdownPreview } = await import("./markdown-preview.tsx");
  return { default: TaskMarkdownPreview };
});

type InspectorProps = {
  task: Task;
  projects: Project[];
  labels: Label[];
  data?: WorkspaceData;
  timeZone: string;
  today: CivilDay;
  initialDraft?: TaskDraft;
  canWrite?: boolean;
  onSave:
    | ((draft: TaskDraft, original?: TaskDraft) => Promise<boolean> | boolean)
    | ((draft: TaskDraft) => void);
  onClose: () => void;
  onToggle: () => void;
  onAskDelete: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onDraftChange?: (draft: TaskDraft | null) => void;
  onCommand?: CommandHandler;
  onDownloadAttachment?: (
    taskId: string,
    commentId: string,
    filename: string,
  ) => Promise<void>;
  onOpenTask?: (task: Task) => void;
};

const recurrenceFrequency =
  /(?:^|[;\n])(?:RRULE:)?FREQ=(?:DAILY|WEEKLY|MONTHLY|YEARLY)(?:$|[;\n])/i;

function draftError(draft: TaskDraft, baseline: TaskDraft): string | undefined {
  if (draft.title.trim() === "") return "Enter a task name before saving.";
  const recurrence = draft.recurrenceRule.trim();
  const scheduleChanged =
    draft.recurrenceRule !== baseline.recurrenceRule ||
    draft.dueDate !== baseline.dueDate;
  if (
    scheduleChanged &&
    recurrence !== "" &&
    !recurrenceFrequency.test(recurrence)
  )
    return "Use a daily, weekly, monthly, or yearly recurrence rule.";
  return scheduleChanged && recurrence !== "" && draft.dueDate === ""
    ? "Set a scheduled date for a repeating task."
    : undefined;
}

function draftMovement(
  props: InspectorProps,
  draft: TaskDraft,
  baseline: TaskDraft,
) {
  if (
    props.data === undefined ||
    props.onCommand === undefined ||
    (draft.projectId === baseline.projectId &&
      draft.sectionId === baseline.sectionId)
  )
    return;
  const tasks = moveTaskTrees(
    props.data.tasks,
    [props.task.id],
    draft.projectId,
    draft.sectionId,
  );
  return {
    run: async () =>
      props.onCommand?.(
        { type: "TaskMove", args: { tasks } },
        { notice: "Moved task" },
      ),
  };
}

function TaskDescription({
  description,
  canWrite,
  onChange,
}: {
  description: string;
  canWrite: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState(description === "");
  return (
    <section aria-label="Task notes">
      <div className="feature-actions">
        <h2>Description</h2>
        {canWrite ? (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setEditing(!editing);
            }}
          >
            {editing ? "Preview" : "Edit Markdown"}
          </button>
        ) : null}
      </div>
      {editing && canWrite ? (
        <>
          <label htmlFor={id} className="visually-hidden">
            Description
          </label>
          <textarea
            id={id}
            rows={6}
            value={description}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        </>
      ) : (
        <div className="feature-markdown">
          {description.trim() === "" ? (
            <p className="feature-note">No description yet.</p>
          ) : (
            <Suspense
              fallback={
                <p className="feature-note" role="status">
                  Loading preview…
                </p>
              }
            >
              <MarkdownPreview description={description} />
            </Suspense>
          )}
        </div>
      )}
    </section>
  );
}

export function InspectorForm(props: InspectorProps) {
  const [baseline, setBaseline] = useState(() =>
    taskDraft(props.task, props.timeZone),
  );
  const [draft, setDraft] = useState(() => props.initialDraft ?? baseline);
  const [received, setReceived] = useState(() => JSON.stringify(baseline));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const formId = useId();
  const canWrite = props.canWrite !== false;
  const { onDraftChange, onDirtyChange } = props;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  useEffect(() => {
    const next = taskDraft(props.task, props.timeZone);
    const serialized = JSON.stringify(next);
    if (received === serialized) return;
    setReceived(serialized);
    if (!dirty) {
      setBaseline(next);
      setDraft(next);
    }
  }, [dirty, props.task, props.timeZone, received]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    onDraftChange?.(dirty ? draft : null);
  }, [dirty, draft, onDraftChange, onDirtyChange]);

  async function save() {
    if (pending || !canWrite || !dirty) return;
    const message = draftError(draft, baseline);
    if (message !== undefined) {
      setError(message);
      return;
    }
    setPending(true);
    setError("");
    try {
      const movement = draftMovement(props, draft, baseline);
      const saveDraft =
        movement === undefined
          ? draft
          : {
              ...draft,
              projectId: baseline.projectId,
              sectionId: baseline.sectionId,
            };
      if ((await props.onSave(saveDraft, baseline)) === false) return;
      setBaseline(saveDraft);
      if (movement !== undefined && (await movement.run()) !== true) return;
      setBaseline(draft);
      onDirtyChange?.(false);
      onDraftChange?.(null);
    } catch (error_) {
      setError(
        error_ instanceof Error ? error_.message : "Couldn’t save this task.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="sheet inspector feature-detail">
      <header className="feature-actions feature-detail-toolbar">
        <h2 id="inspector-title" className="feature-title">
          Task details
        </h2>
        <div className="feature-chips">
          <button
            type="button"
            className="text-button"
            disabled={pending}
            onClick={props.onClose}
          >
            Close
          </button>
          {canWrite ? (
            <button
              className="primary"
              form={formId}
              type="submit"
              disabled={pending || !dirty}
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          ) : null}
        </div>
      </header>
      <form
        id={formId}
        className="feature-form"
        aria-labelledby="inspector-title"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="feature-form">
          <label htmlFor={titleId}>Task name</label>
          <input
            id={titleId}
            type="text"
            name="title"
            value={draft.title}
            readOnly={!canWrite}
            required
            onChange={(event) => {
              setDraft({ ...draft, title: event.target.value });
            }}
          />
        </div>
        {error === "" ? null : (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div className="feature-detail-grid">
          <TaskDescription
            description={draft.description}
            canWrite={canWrite}
            onChange={(description) => {
              setDraft({ ...draft, description });
            }}
          />
          <div className="feature-form">
            <ScheduleFields
              draft={draft}
              setDraft={setDraft}
              today={props.today}
              disabled={!canWrite}
            />
            <OrganizationFields
              props={props}
              draft={draft}
              setDraft={setDraft}
              disabled={!canWrite}
            />
          </div>
        </div>
        {canWrite ? (
          <div className="feature-actions">
            <button
              type="button"
              className="text-button"
              onClick={props.onToggle}
            >
              {props.task.completed ? "Reopen task" : "Complete task"}
            </button>
            <button
              type="button"
              className="danger"
              onClick={props.onAskDelete}
            >
              Delete task
            </button>
          </div>
        ) : null}
      </form>
      {props.data === undefined ? null : (
        <TaskDiscussion
          task={props.task}
          data={props.data}
          canWrite={canWrite}
          {...(props.onCommand === undefined
            ? {}
            : { onCommand: props.onCommand })}
          {...(props.onOpenTask === undefined
            ? {}
            : { onOpenTask: props.onOpenTask })}
          {...(props.onDownloadAttachment === undefined
            ? {}
            : { onDownloadAttachment: props.onDownloadAttachment })}
        />
      )}
    </div>
  );
}
