import type {
  Filter,
  Label,
  Project,
  Reminder,
  Section,
  Task,
} from "../../protocol/generated.ts";
import { inferTaskUpdateAction } from "../audit-diff.ts";
import type { ActorKind } from "../auth-types.ts";
import { applyCommentMutation } from "../comments.ts";
import { buildTaskCompletionUpdate } from "../recurrence.ts";
import {
  applyTaskUpdateDates,
  applyTaskUpdateFields,
  assertOwnedEntry,
  MonotonicClock,
  newMemoryTask,
  queryStoredEntries,
  restoreMap,
  type StoredEntry,
  type StoredUser,
} from "./in-memory-helpers.ts";
import {
  getOwnedInMemoryItem,
  type InMemorySecondaryCtx,
} from "./in-memory-secondary.ts";
import {
  recordInMemoryMutation,
  type StoredApiToken,
  type StoredMutationEvent,
} from "./in-memory-tokens-audit.ts";
import { recordTaskMutationMetric } from "../mappers.ts";
import {
  type CreateTaskInput,
  EntityNotFoundError,
  type ListTasksFilter,
  type UpdateTaskInput,
} from "../types.ts";

export type StoredProcessedCommand = {
  uuid: string;
  userId: string;
  status: string;
  resultId: string | null;
  tokenId: string | null;
  actorName: string | null;
  actorKind: ActorKind | null;
};

export type InMemoryBackingState = {
  attachments: Map<string, Map<string, Uint8Array<ArrayBuffer>>>;
  clock: MonotonicClock;
  users: Map<string, StoredUser>;
  tasks: Map<string, StoredEntry<Task>>;
  projects: Map<string, StoredEntry<Project>>;
  sections: Map<string, StoredEntry<Section>>;
  labels: Map<string, StoredEntry<Label>>;
  reminders: Map<string, StoredEntry<Reminder>>;
  filters: Map<string, StoredEntry<Filter>>;
  processedCommands: Map<string, StoredProcessedCommand>;
  apiTokens: Map<string, StoredApiToken>;
  mutationEvents: Map<string, StoredMutationEvent>;
};

export function createEmptyBackingState(): InMemoryBackingState {
  return {
    attachments: new Map(),
    clock: new MonotonicClock(),
    users: new Map(),
    tasks: new Map(),
    projects: new Map(),
    sections: new Map(),
    labels: new Map(),
    reminders: new Map(),
    filters: new Map(),
    processedCommands: new Map(),
    apiTokens: new Map(),
    mutationEvents: new Map(),
  };
}

export async function runWithInMemorySavepoint<T>(
  state: InMemoryBackingState,
  fn: () => Promise<T>,
): Promise<T> {
  const clockSnap = state.clock.snapshot();
  const usersSnap = structuredClone(state.users);
  const attachmentSnap = structuredClone(state.attachments);
  const tasksSnap = structuredClone(state.tasks);
  const projectsSnap = structuredClone(state.projects);
  const sectionsSnap = structuredClone(state.sections);
  const labelsSnap = structuredClone(state.labels);
  const remindersSnap = structuredClone(state.reminders);
  const filtersSnap = structuredClone(state.filters);
  const commandsSnap = structuredClone(state.processedCommands);
  const tokensSnap = structuredClone(state.apiTokens);
  const eventsSnap = structuredClone(state.mutationEvents);
  try {
    return await fn();
  } catch (error: unknown) {
    state.clock.restore(clockSnap);
    restoreMap(state.users, usersSnap);
    restoreMap(state.tasks, tasksSnap);
    restoreMap(state.attachments, attachmentSnap);
    restoreMap(state.projects, projectsSnap);
    restoreMap(state.sections, sectionsSnap);
    restoreMap(state.labels, labelsSnap);
    restoreMap(state.reminders, remindersSnap);
    restoreMap(state.filters, filtersSnap);
    restoreMap(state.processedCommands, commandsSnap);
    restoreMap(state.apiTokens, tokensSnap);
    restoreMap(state.mutationEvents, eventsSnap);
    throw error;
  }
}

function validateInMemoryLabelIds(
  ctx: InMemorySecondaryCtx,
  userId: string,
  labelIds: string[],
): string[] {
  const deduped = [...new Set(labelIds)];
  for (const labelId of deduped) {
    const label = ctx.labels.get(labelId);
    if (label?.userId !== userId || label.value.is_deleted) {
      throw new EntityNotFoundError("Label", labelId);
    }
  }
  return deduped;
}

function validateInMemoryTaskRefs(
  ctx: InMemorySecondaryCtx,
  userId: string,
  refs: {
    projectId: string | undefined;
    sectionId: string | null | undefined;
    currentProjectId?: string | undefined;
    currentSectionId?: string | undefined;
  },
): void {
  if (refs.projectId === undefined && refs.sectionId === undefined) {
    return;
  }
  if (refs.projectId !== undefined) {
    assertOwnedEntry(ctx.projects, refs.projectId, userId, "Project");
  }
  const effectiveProjectId = refs.projectId ?? refs.currentProjectId;
  const effectiveSectionId =
    refs.sectionId === undefined ? refs.currentSectionId : refs.sectionId;
  if (
    effectiveSectionId !== undefined &&
    effectiveSectionId !== null &&
    effectiveSectionId !== ""
  ) {
    const sec = assertOwnedEntry(
      ctx.sections,
      effectiveSectionId,
      userId,
      "Section",
    );
    if (
      effectiveProjectId !== undefined &&
      sec.value.project_id !== effectiveProjectId
    ) {
      throw new TypeError(
        "The destination section must belong to the destination project.",
      );
    }
  }
}

export function createInMemoryTask(
  ctx: InMemorySecondaryCtx,
  data: CreateTaskInput,
): Task {
  validateInMemoryTaskRefs(ctx, data.userId, {
    projectId: data.projectId,
    sectionId: data.sectionId,
  });
  const labelIds =
    data.labelIds === undefined
      ? []
      : validateInMemoryLabelIds(ctx, data.userId, data.labelIds);
  const id = data.id ?? crypto.randomUUID();
  const now = ctx.clock.now();
  const task = newMemoryTask(data, id, now.toISOString(), labelIds);
  const syncSeq = ctx.nextSyncSeq(data.userId);
  ctx.tasks.set(id, {
    value: task,
    userId: data.userId,
    updatedAt: now,
    syncSeq,
  });
  recordTaskMutationMetric("created");
  const cloned = structuredClone(task);
  recordInMemoryMutation(ctx.mutationEvents, ctx.clock, {
    userId: data.userId,
    syncSeq,
    entityType: "task",
    entityId: id,
    action: ctx.audit?.actionHint ?? "create",
    audit: ctx.audit,
    before: null,
    after: cloned,
  });
  return cloned;
}

export function updateInMemoryTask(
  ctx: InMemorySecondaryCtx,
  attachments: Map<string, Map<string, Uint8Array<ArrayBuffer>>>,
  id: string,
  options: { userId: string; data: UpdateTaskInput },
): Task | null {
  const entry = ctx.tasks.get(id);
  if (entry?.userId !== options.userId) {
    return null;
  }
  validateInMemoryTaskRefs(ctx, options.userId, {
    projectId: options.data.projectId,
    sectionId: options.data.sectionId,
    currentProjectId: entry.value.project_id,
    currentSectionId: entry.value.section_id,
  });
  const validated: UpdateTaskInput =
    options.data.labelIds === undefined
      ? options.data
      : {
          ...options.data,
          labelIds: validateInMemoryLabelIds(
            ctx,
            options.userId,
            options.data.labelIds,
          ),
        };
  const updated = ctx.mutateWithAudit({
    map: ctx.tasks,
    id,
    userId: options.userId,
    entityType: "task",
    resolveAction: (before, after) =>
      inferTaskUpdateAction(before, after, validated, ctx.audit?.actionHint),
    mutate: (task, nowIso) => {
      applyCommentMutation(task, validated, attachments);
      applyTaskUpdateFields(task, validated);
      applyTaskUpdateDates(task, validated);
      task.updated_at = nowIso;
    },
  });
  if (updated !== null) {
    recordTaskMutationMetric(
      validated.isDeleted === true ? "deleted" : "updated",
    );
  }
  return updated;
}

export function completeInMemoryTask(
  ctx: InMemorySecondaryCtx,
  attachments: Map<string, Map<string, Uint8Array<ArrayBuffer>>>,
  id: string,
  options: { userId: string; completedAt: Date },
): Task | null {
  const entry = ctx.tasks.get(id);
  if (entry?.userId !== options.userId || entry.value.is_deleted) {
    return null;
  }
  const update = buildTaskCompletionUpdate(entry.value, options.completedAt);
  const effectiveCtx: InMemorySecondaryCtx =
    ctx.audit === undefined || ctx.audit.actionHint !== undefined
      ? ctx
      : { ...ctx, audit: { ...ctx.audit, actionHint: "complete" } };
  return updateInMemoryTask(effectiveCtx, attachments, id, {
    userId: options.userId,
    data: update,
  });
}

export function getInMemoryTask(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId?: string,
): Task | null {
  return getOwnedInMemoryItem(ctx.tasks, id, userId);
}

export function listInMemoryTasks(
  ctx: InMemorySecondaryCtx,
  filter: ListTasksFilter,
): Task[] {
  const pid =
    filter.projectId === undefined || filter.projectId === ""
      ? undefined
      : filter.projectId;
  return queryStoredEntries(ctx.tasks, filter, {
    predicate: pid === undefined ? undefined : (t) => t.project_id === pid,
    compare: (a, b) => a.child_order - b.child_order,
  });
}
