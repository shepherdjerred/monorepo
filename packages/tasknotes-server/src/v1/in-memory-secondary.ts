import type {
  Filter,
  Label,
  Project,
  Reminder,
  Section,
  Task,
} from "../protocol/generated.ts";
import {
  applyFilterUpdate,
  applyLabelUpdate,
  applyReminderUpdate,
  applySectionUpdate,
  assertOwnedEntry,
  type MonotonicClock,
  queryStoredEntries,
  type StoredEntry,
} from "./in-memory-helpers.ts";
import type {
  CreateFilterInput,
  CreateLabelInput,
  CreateReminderInput,
  CreateSectionInput,
  ListFiltersFilter,
  ListLabelsFilter,
  ListRemindersFilter,
  ListSectionsFilter,
  UpdateFilterInput,
  UpdateLabelInput,
  UpdateReminderInput,
  UpdateSectionInput,
} from "./types.ts";

export type InMemorySecondaryCtx = {
  clock: MonotonicClock;
  tasks: Map<string, StoredEntry<Task>>;
  projects: Map<string, StoredEntry<Project>>;
  sections: Map<string, StoredEntry<Section>>;
  labels: Map<string, StoredEntry<Label>>;
  reminders: Map<string, StoredEntry<Reminder>>;
  filters: Map<string, StoredEntry<Filter>>;
  nextSyncSeq: (userId: string) => bigint;
  mutateEntry: <T>(
    map: Map<string, StoredEntry<T>>,
    id: string,
    userId: string,
    mutate: (val: T, nowIso: string) => void,
  ) => T | null;
};

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
  ctx.sections.set(id, {
    value: section,
    userId: data.userId,
    updatedAt: now,
    syncSeq: ctx.nextSyncSeq(data.userId),
  });
  return structuredClone(section);
}

export function updateInMemorySection(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId: string,
  data: UpdateSectionInput,
): Section | null {
  return ctx.mutateEntry(ctx.sections, id, userId, (sec, nowIso) => {
    applySectionUpdate(sec, data);
    sec.updated_at = nowIso;
  });
}

export function listInMemorySections(
  ctx: InMemorySecondaryCtx,
  filter: ListSectionsFilter,
): Section[] {
  const pid =
    filter.projectId !== undefined && filter.projectId !== ""
      ? filter.projectId
      : undefined;
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
  ctx.labels.set(id, {
    value: label,
    userId: data.userId,
    updatedAt: now,
    syncSeq: ctx.nextSyncSeq(data.userId),
  });
  return structuredClone(label);
}

export function updateInMemoryLabel(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId: string,
  data: UpdateLabelInput,
): Label | null {
  return ctx.mutateEntry(ctx.labels, id, userId, (lbl) => {
    applyLabelUpdate(lbl, data);
  });
}

export function deleteInMemoryLabel(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId: string,
): boolean {
  const deleted = ctx.mutateEntry(ctx.labels, id, userId, (lbl) => {
    lbl.is_deleted = true;
  });
  if (deleted === null) {
    return false;
  }
  for (const taskEntry of ctx.tasks.values()) {
    if (taskEntry.userId === userId && taskEntry.value.label_ids.includes(id)) {
      ctx.mutateEntry(ctx.tasks, taskEntry.value.id, userId, (t, iso) => {
        t.label_ids = t.label_ids.filter((lid) => lid !== id);
        t.updated_at = iso;
      });
    }
  }
  return true;
}

export function listInMemoryLabels(
  ctx: InMemorySecondaryCtx,
  filter: ListLabelsFilter,
): Label[] {
  return queryStoredEntries(ctx.labels, filter, {
    compare: (a, b) => a.item_order - b.item_order,
  });
}

export function createInMemoryReminder(
  ctx: InMemorySecondaryCtx,
  data: CreateReminderInput,
): Reminder {
  assertOwnedEntry(ctx.tasks, data.taskId, data.userId, "Task");
  const id = data.id ?? crypto.randomUUID();
  const now = ctx.clock.now();
  const reminder: Reminder = {
    id,
    task_id: data.taskId,
    reminder_type: data.reminderType,
    is_notified: data.isNotified ?? false,
    is_deleted: false,
    updated_at: now.toISOString(),
  };
  if (data.minuteOffset !== undefined && data.minuteOffset !== null) {
    reminder.minute_offset = data.minuteOffset;
  }
  if (data.dueDatetime !== undefined && data.dueDatetime !== null) {
    reminder.due_datetime = data.dueDatetime.toISOString();
  }
  ctx.reminders.set(id, {
    value: reminder,
    userId: data.userId,
    updatedAt: now,
    syncSeq: ctx.nextSyncSeq(data.userId),
  });
  return structuredClone(reminder);
}

export function updateInMemoryReminder(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId: string,
  data: UpdateReminderInput,
): Reminder | null {
  return ctx.mutateEntry(ctx.reminders, id, userId, (rem, nowIso) => {
    applyReminderUpdate(rem, data);
    rem.updated_at = nowIso;
  });
}

export function listInMemoryReminders(
  ctx: InMemorySecondaryCtx,
  filter: ListRemindersFilter,
): Reminder[] {
  const tid =
    filter.taskId !== undefined && filter.taskId !== ""
      ? filter.taskId
      : undefined;
  return queryStoredEntries(ctx.reminders, filter, {
    predicate: tid === undefined ? undefined : (r) => r.task_id === tid,
  });
}

export function createInMemoryFilter(
  ctx: InMemorySecondaryCtx,
  data: CreateFilterInput,
): Filter {
  const id = data.id ?? crypto.randomUUID();
  const now = ctx.clock.now();
  const created: Filter = {
    id,
    user_id: data.userId,
    name: data.name,
    query: data.query,
    color: data.color ?? "charcoal",
    item_order: data.itemOrder ?? 0,
    is_favorite: data.isFavorite ?? false,
    is_deleted: false,
  };
  ctx.filters.set(id, {
    value: created,
    userId: data.userId,
    updatedAt: now,
    syncSeq: ctx.nextSyncSeq(data.userId),
  });
  return structuredClone(created);
}

export function updateInMemoryFilter(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId: string,
  data: UpdateFilterInput,
): Filter | null {
  return ctx.mutateEntry(ctx.filters, id, userId, (flt) => {
    applyFilterUpdate(flt, data);
  });
}

export function listInMemoryFilters(
  ctx: InMemorySecondaryCtx,
  filter: ListFiltersFilter,
): Filter[] {
  return queryStoredEntries(ctx.filters, filter, {
    compare: (a, b) => a.item_order - b.item_order,
  });
}
