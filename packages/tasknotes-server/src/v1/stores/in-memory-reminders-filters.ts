import type { Filter, Reminder } from "../../protocol/generated.ts";
import { inferDeleteOrRestoreAction } from "../audit-diff.ts";
import {
  applyFilterUpdate,
  applyReminderUpdate,
  assertOwnedEntry,
  queryStoredEntries,
} from "./in-memory-helpers.ts";
import {
  getOwnedInMemoryItem,
  type InMemorySecondaryCtx,
} from "./in-memory-secondary.ts";
import { recordInMemoryMutation } from "./in-memory-tokens-audit.ts";
import type {
  CreateFilterInput,
  CreateReminderInput,
  ListFiltersFilter,
  ListRemindersFilter,
  UpdateFilterInput,
  UpdateReminderInput,
} from "../types.ts";

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
  const syncSeq = ctx.nextSyncSeq(data.userId);
  ctx.reminders.set(id, {
    value: reminder,
    userId: data.userId,
    updatedAt: now,
    syncSeq,
  });
  const cloned = structuredClone(reminder);
  recordInMemoryMutation(ctx.mutationEvents, ctx.clock, {
    userId: data.userId,
    syncSeq,
    entityType: "reminder",
    entityId: id,
    action: ctx.audit?.actionHint ?? "create",
    audit: ctx.audit,
    before: null,
    after: cloned,
  });
  return cloned;
}

export function updateInMemoryReminder(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId: string,
  data: UpdateReminderInput,
): Reminder | null {
  return ctx.mutateWithAudit({
    map: ctx.reminders,
    id,
    userId,
    entityType: "reminder",
    resolveAction: (before, after) =>
      inferDeleteOrRestoreAction(
        before.is_deleted,
        after.is_deleted,
        ctx.audit?.actionHint,
      ),
    mutate: (rem, nowIso) => {
      applyReminderUpdate(rem, data);
      rem.updated_at = nowIso;
    },
  });
}

export function getInMemoryReminder(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId?: string,
): Reminder | null {
  return getOwnedInMemoryItem(ctx.reminders, id, userId);
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
  const syncSeq = ctx.nextSyncSeq(data.userId);
  ctx.filters.set(id, {
    value: created,
    userId: data.userId,
    updatedAt: now,
    syncSeq,
  });
  const cloned = structuredClone(created);
  recordInMemoryMutation(ctx.mutationEvents, ctx.clock, {
    userId: data.userId,
    syncSeq,
    entityType: "filter",
    entityId: id,
    action: ctx.audit?.actionHint ?? "create",
    audit: ctx.audit,
    before: null,
    after: cloned,
  });
  return cloned;
}

export function updateInMemoryFilter(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId: string,
  data: UpdateFilterInput,
): Filter | null {
  return ctx.mutateWithAudit({
    map: ctx.filters,
    id,
    userId,
    entityType: "filter",
    resolveAction: (before, after) =>
      inferDeleteOrRestoreAction(
        before.is_deleted,
        after.is_deleted,
        ctx.audit?.actionHint,
      ),
    mutate: (flt) => {
      applyFilterUpdate(flt, data);
    },
  });
}

export function getInMemoryFilter(
  ctx: InMemorySecondaryCtx,
  id: string,
  userId?: string,
): Filter | null {
  return getOwnedInMemoryItem(ctx.filters, id, userId);
}

export function listInMemoryFilters(
  ctx: InMemorySecondaryCtx,
  filter: ListFiltersFilter,
): Filter[] {
  return queryStoredEntries(ctx.filters, filter, {
    compare: (a, b) => a.item_order - b.item_order,
  });
}
