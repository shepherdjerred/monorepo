import type { Priority } from "../../domain/priority";
import { isCuratedRecurrenceRule } from "../../domain/recurrence-options";
import type { Task, UpdateTaskRequest } from "../../domain/types";

export type TaskDetailDraft = {
  readonly title: string;
  readonly details: string;
  readonly priority: Priority;
  readonly due: string | null;
  readonly scheduled: string | null;
  readonly projects: readonly string[];
  readonly contexts: readonly string[];
  readonly tags: readonly string[];
  readonly recurrence: string;
  readonly recurrenceAnchor: "scheduled" | "completion";
  readonly timeEstimate: string;
};

export type TaskDetailPatchResult =
  | { readonly ok: true; readonly patch: UpdateTaskRequest }
  | {
      readonly ok: false;
      readonly field: "title" | "recurrence" | "timeEstimate";
      readonly message: string;
    };

export function createTaskDetailDraft(task: Task): TaskDetailDraft {
  return {
    title: task.title,
    details: task.details ?? "",
    priority: task.priority,
    due: task.due ?? null,
    scheduled: task.scheduled ?? null,
    projects: task.projects.map(String),
    contexts: task.contexts.map(String),
    tags: task.tags.map(String),
    recurrence: task.recurrence ?? "",
    recurrenceAnchor: task.recurrenceAnchor ?? "scheduled",
    timeEstimate:
      task.timeEstimate === undefined ? "" : String(task.timeEstimate),
  };
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function optionalText(value: string): string | null {
  return value.length === 0 ? null : value;
}

function parseTimeEstimate(value: string): number | null | undefined {
  if (value.trim().length === 0) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

export function buildTaskDetailPatch(
  task: Task,
  draft: TaskDetailDraft,
): TaskDetailPatchResult {
  if (draft.title.trim().length === 0) {
    return { ok: false, field: "title", message: "Title is required" };
  }

  const timeEstimate = parseTimeEstimate(draft.timeEstimate);
  if (timeEstimate === undefined) {
    return {
      ok: false,
      field: "timeEstimate",
      message: "Estimate must be a non-negative number of minutes",
    };
  }

  const recurrence = optionalText(draft.recurrence);
  const originalRecurrence = optionalText(task.recurrence ?? "");
  if (
    recurrence !== originalRecurrence &&
    recurrence !== null &&
    !isCuratedRecurrenceRule(recurrence)
  ) {
    return {
      ok: false,
      field: "recurrence",
      message: "Choose a supported repeat schedule",
    };
  }

  const patch: UpdateTaskRequest = {};
  applyCorePatch(task, draft, patch);
  applyRecurrencePatch(task, draft, patch);

  if (timeEstimate !== (task.timeEstimate ?? null)) {
    patch.timeEstimate = timeEstimate;
  }

  return { ok: true, patch };
}

function applyCorePatch(
  task: Task,
  draft: TaskDetailDraft,
  patch: UpdateTaskRequest,
): void {
  if (draft.title !== task.title) patch.title = draft.title;

  const details = optionalText(draft.details);
  if (details !== optionalText(task.details ?? "")) patch.details = details;

  if (draft.priority !== task.priority) patch.priority = draft.priority;
  if (draft.due !== (task.due ?? null)) patch.due = draft.due;
  if (draft.scheduled !== (task.scheduled ?? null)) {
    patch.scheduled = draft.scheduled;
  }

  const projects = task.projects.map(String);
  if (!arraysEqual(draft.projects, projects)) {
    patch.projects = [...draft.projects];
  }

  const contexts = task.contexts.map(String);
  if (!arraysEqual(draft.contexts, contexts)) {
    patch.contexts = [...draft.contexts];
  }

  const tags = task.tags.map(String);
  if (!arraysEqual(draft.tags, tags)) patch.tags = [...draft.tags];
}

function applyRecurrencePatch(
  task: Task,
  draft: TaskDetailDraft,
  patch: UpdateTaskRequest,
): void {
  const recurrence = optionalText(draft.recurrence);
  const originalRecurrence = optionalText(task.recurrence ?? "");
  if (recurrence !== originalRecurrence) patch.recurrence = recurrence;

  const originalAnchor = task.recurrenceAnchor ?? "scheduled";
  if (recurrence === null) {
    if (task.recurrenceAnchor !== undefined) patch.recurrenceAnchor = null;
  } else if (
    originalRecurrence === null ||
    draft.recurrenceAnchor !== originalAnchor
  ) {
    patch.recurrenceAnchor = draft.recurrenceAnchor;
  }
}

export function taskDetailDraftIsDirty(
  task: Task,
  draft: TaskDetailDraft,
): boolean {
  const result = buildTaskDetailPatch(task, draft);
  if (!result.ok) return true;
  return Object.keys(result.patch).length > 0;
}

export function rebaseTaskDetailDraft(
  baseTask: Task,
  updatedTask: Task,
  draft: TaskDetailDraft,
): TaskDetailDraft {
  const base = createTaskDetailDraft(baseTask);
  const updated = createTaskDetailDraft(updatedTask);

  return {
    title: draft.title === base.title ? updated.title : draft.title,
    details: draft.details === base.details ? updated.details : draft.details,
    priority:
      draft.priority === base.priority ? updated.priority : draft.priority,
    due: draft.due === base.due ? updated.due : draft.due,
    scheduled:
      draft.scheduled === base.scheduled ? updated.scheduled : draft.scheduled,
    projects: arraysEqual(draft.projects, base.projects)
      ? updated.projects
      : draft.projects,
    contexts: arraysEqual(draft.contexts, base.contexts)
      ? updated.contexts
      : draft.contexts,
    tags: arraysEqual(draft.tags, base.tags) ? updated.tags : draft.tags,
    recurrence:
      draft.recurrence === base.recurrence
        ? updated.recurrence
        : draft.recurrence,
    recurrenceAnchor:
      draft.recurrenceAnchor === base.recurrenceAnchor
        ? updated.recurrenceAnchor
        : draft.recurrenceAnchor,
    timeEstimate:
      draft.timeEstimate === base.timeEstimate
        ? updated.timeEstimate
        : draft.timeEstimate,
  };
}

export function formatTaskMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error("Task minutes must be a finite non-negative number");
  }
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}
