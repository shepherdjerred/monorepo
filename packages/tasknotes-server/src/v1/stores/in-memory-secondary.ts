import type {
  Filter,
  Label,
  Project,
  Reminder,
  Section,
  Task,
} from "../../protocol/generated.ts";
import { inferDeleteOrRestoreAction } from "../audit-diff.ts";
import type {
  AuditContext,
  MutationAction,
  MutationEntityType,
} from "../auth-types.ts";
import {
  applyLabelUpdate,
  applyProjectUpdate,
  applySectionUpdate,
  assertOwnedEntry,
  type MonotonicClock,
  queryStoredEntries,
  type StoredEntry,
} from "./in-memory-helpers.ts";
import {
  recordInMemoryMutation,
  type StoredMutationEvent,
} from "./in-memory-tokens-audit.ts";
import type {
  CreateLabelInput,
  CreateProjectInput,
  CreateSectionInput,
  ListLabelsFilter,
  ListProjectsFilter,
  ListSectionsFilter,
  UpdateLabelInput,
  UpdateProjectInput,
  UpdateSectionInput,
} from "../types.ts";

export type InMemorySecondaryCtx = {
  clock: MonotonicClock;
  audit: AuditContext | undefined;
  mutationEvents: Map<string, StoredMutationEvent>;
  tasks: Map<string, StoredEntry<Task>>;
  projects: Map<string, StoredEntry<Project>>;
  sections: Map<string, StoredEntry<Section>>;
  labels: Map<string, StoredEntry<Label>>;
  reminders: Map<string, StoredEntry<Reminder>>;
  filters: Map<string, StoredEntry<Filter>>;
  nextSyncSeq: (userId: string) => bigint;
  mutateWithAudit: <T extends object>(params: {
    map: Map<string, StoredEntry<T>>;
    id: string;
    userId: string;
    entityType: MutationEntityType;
    resolveAction: (before: T, after: T) => MutationAction;
    mutate: (val: T, nowIso: string) => void;
  }) => T | null;
};

export function getOwnedInMemoryItem<T>(
  map: Map<string, StoredEntry<T>>,
  id: string,
  userId?: string,
): T | null {
  const entry = map.get(id);
  return entry === undefined ||
    (userId !== undefined && userId !== "" && entry.userId !== userId)
    ? null
    : structuredClone(entry.value);
}

export function createInMemoryProject(
  ctx: InMemorySecondaryCtx,
  data: CreateProjectInput,
): Project {
  const id = data.id ?? crypto.randomUUID();
  const now = ctx.clock.now();
  const nowIso = now.toISOString();
  const project: Project = {
    id,
    user_id: data.userId,
    name: data.name,
    color: data.color ?? "charcoal",
    child_order: data.childOrder ?? 0,
    is_inbox: data.isInbox ?? false,
    is_favorite: data.isFavorite ?? false,
    is_archived: data.isArchived ?? false,
    is_deleted: false,
    created_at: nowIso,
    updated_at: nowIso,
  };
  if (
    data.parentId !== undefined &&
    data.parentId !== null &&
    data.parentId !== ""
  ) {
    project.parent_id = data.parentId;
  }
  const syncSeq = ctx.nextSyncSeq(data.userId);
  ctx.projects.set(id, {
    value: project,
    userId: data.userId,
    updatedAt: now,
    syncSeq,
  });
  const cloned = structuredClone(project);
  recordInMemoryMutation(ctx.mutationEvents, ctx.clock, {
    userId: data.userId,
    syncSeq,
    entityType: "project",
    entityId: id,
    action: ctx.audit?.actionHint ?? "create",
    audit: ctx.audit,
    before: null,
    after: cloned,
  });
  return cloned;
}

export function updateInMemoryProject(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId: string,
  data: UpdateProjectInput,
): Project | null {
  return ctx.mutateWithAudit({
    map: ctx.projects,
    id,
    userId,
    entityType: "project",
    resolveAction: (before, after) =>
      inferDeleteOrRestoreAction(
        before.is_deleted,
        after.is_deleted,
        ctx.audit?.actionHint,
      ),
    mutate: (proj, nowIso) => {
      applyProjectUpdate(proj, data);
      proj.updated_at = nowIso;
    },
  });
}

export function getInMemoryProject(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId?: string,
): Project | null {
  return getOwnedInMemoryItem(ctx.projects, id, userId);
}

export function listInMemoryProjects(
  ctx: InMemorySecondaryCtx,
  filter: ListProjectsFilter,
): Project[] {
  return queryStoredEntries(ctx.projects, filter, {
    compare: (a, b) => a.child_order - b.child_order,
  });
}

export function createInMemorySection(
  ctx: InMemorySecondaryCtx,
  data: CreateSectionInput,
): Section {
  assertOwnedEntry(ctx.projects, data.projectId, data.userId, "Project");
  const id = data.id ?? crypto.randomUUID();
  const now = ctx.clock.now();
  const nowIso = now.toISOString();
  const section: Section = {
    id,
    project_id: data.projectId,
    user_id: data.userId,
    name: data.name,
    section_order: data.sectionOrder ?? 0,
    is_archived: false,
    is_deleted: false,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const syncSeq = ctx.nextSyncSeq(data.userId);
  ctx.sections.set(id, {
    value: section,
    userId: data.userId,
    updatedAt: now,
    syncSeq,
  });
  const cloned = structuredClone(section);
  recordInMemoryMutation(ctx.mutationEvents, ctx.clock, {
    userId: data.userId,
    syncSeq,
    entityType: "section",
    entityId: id,
    action: ctx.audit?.actionHint ?? "create",
    audit: ctx.audit,
    before: null,
    after: cloned,
  });
  return cloned;
}

export function updateInMemorySection(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId: string,
  data: UpdateSectionInput,
): Section | null {
  return ctx.mutateWithAudit({
    map: ctx.sections,
    id,
    userId,
    entityType: "section",
    resolveAction: (before, after) =>
      inferDeleteOrRestoreAction(
        before.is_deleted,
        after.is_deleted,
        ctx.audit?.actionHint,
      ),
    mutate: (sec, nowIso) => {
      applySectionUpdate(sec, data);
      sec.updated_at = nowIso;
    },
  });
}

export function getInMemorySection(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId?: string,
): Section | null {
  return getOwnedInMemoryItem(ctx.sections, id, userId);
}

export function listInMemorySections(
  ctx: InMemorySecondaryCtx,
  filter: ListSectionsFilter,
): Section[] {
  const pid =
    filter.projectId === undefined || filter.projectId === ""
      ? undefined
      : filter.projectId;
  return queryStoredEntries(ctx.sections, filter, {
    predicate: pid === undefined ? undefined : (s) => s.project_id === pid,
    compare: (a, b) => a.section_order - b.section_order,
  });
}

export function createInMemoryLabel(
  ctx: InMemorySecondaryCtx,
  data: CreateLabelInput,
): Label {
  const id = data.id ?? crypto.randomUUID();
  const now = ctx.clock.now();
  const label: Label = {
    id,
    user_id: data.userId,
    name: data.name,
    color: data.color ?? "grey",
    item_order: data.itemOrder ?? 0,
    is_favorite: data.isFavorite ?? false,
    is_deleted: false,
  };
  const syncSeq = ctx.nextSyncSeq(data.userId);
  ctx.labels.set(id, {
    value: label,
    userId: data.userId,
    updatedAt: now,
    syncSeq,
  });
  const cloned = structuredClone(label);
  recordInMemoryMutation(ctx.mutationEvents, ctx.clock, {
    userId: data.userId,
    syncSeq,
    entityType: "label",
    entityId: id,
    action: ctx.audit?.actionHint ?? "create",
    audit: ctx.audit,
    before: null,
    after: cloned,
  });
  return cloned;
}

export function updateInMemoryLabel(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId: string,
  data: UpdateLabelInput,
): Label | null {
  return ctx.mutateWithAudit({
    map: ctx.labels,
    id,
    userId,
    entityType: "label",
    resolveAction: (before, after) =>
      inferDeleteOrRestoreAction(
        before.is_deleted,
        after.is_deleted,
        ctx.audit?.actionHint,
      ),
    mutate: (lbl) => {
      applyLabelUpdate(lbl, data);
    },
  });
}

export function deleteInMemoryLabel(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId: string,
): boolean {
  const deleted = ctx.mutateWithAudit({
    map: ctx.labels,
    id,
    userId,
    entityType: "label",
    resolveAction: () => "delete",
    mutate: (lbl) => {
      lbl.is_deleted = true;
    },
  });
  if (deleted === null) {
    return false;
  }
  for (const [taskId, taskEntry] of ctx.tasks.entries()) {
    if (taskEntry.userId === userId && taskEntry.value.label_ids.includes(id)) {
      ctx.mutateWithAudit({
        map: ctx.tasks,
        id: taskId,
        userId,
        entityType: "task",
        resolveAction: () => "update",
        mutate: (task, nowIso) => {
          task.label_ids = task.label_ids.filter((lid) => lid !== id);
          task.updated_at = nowIso;
        },
      });
    }
  }
  return true;
}

export function getInMemoryLabel(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId?: string,
): Label | null {
  return getOwnedInMemoryItem(ctx.labels, id, userId);
}

export function listInMemoryLabels(
  ctx: InMemorySecondaryCtx,
  filter: ListLabelsFilter,
): Label[] {
  return queryStoredEntries(ctx.labels, filter, {
    compare: (a, b) => a.item_order - b.item_order,
  });
}
