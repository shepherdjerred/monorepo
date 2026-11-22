import type { Prisma } from "#generated/prisma/client.ts";
import type { Filter, Reminder } from "../../protocol/generated.ts";
import { inferDeleteOrRestoreAction } from "../audit-diff.ts";
import { toProtocolFilter, toProtocolReminder } from "../mappers.ts";
import {
  buildFilterUpdateData,
  buildReminderUpdateData,
  buildSyncWhereClause,
  lockExistingPrismaUser,
} from "./prisma-helpers.ts";
import type { PrismaSecondaryCtx } from "./prisma-secondary.ts";
import { recordPrismaMutation } from "./prisma-tokens-audit.ts";
import {
  type CreateFilterInput,
  type CreateReminderInput,
  EntityNotFoundError,
  type ListFiltersFilter,
  type ListRemindersFilter,
  type UpdateFilterInput,
  type UpdateReminderInput,
} from "../types.ts";

export async function createPrismaReminder(
  ctx: PrismaSecondaryCtx,
  data: CreateReminderInput,
): Promise<Reminder> {
  const task = await ctx.prisma.task.findFirst({
    where: { id: data.taskId, userId: data.userId },
    select: { id: true },
  });
  if (task === null) {
    throw new EntityNotFoundError("Task", data.taskId);
  }
  const syncSeq = await ctx.nextSyncSeq(data.userId);
  const created = await ctx.prisma.reminder.create({
    data: {
      id: data.id ?? crypto.randomUUID(),
      taskId: data.taskId,
      reminderType: data.reminderType,
      minuteOffset: data.minuteOffset ?? null,
      dueDatetime: data.dueDatetime ?? null,
      isNotified: data.isNotified ?? false,
      syncSeq,
    },
  });
  const mapped = toProtocolReminder(created);
  await recordPrismaMutation(ctx.prisma, {
    userId: data.userId,
    syncSeq,
    entityType: "reminder",
    entityId: mapped.id,
    action: ctx.audit?.actionHint ?? "create",
    audit: ctx.audit,
    before: null,
    after: mapped,
  });
  return mapped;
}

export async function updatePrismaReminder(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
  data: UpdateReminderInput,
): Promise<Reminder | null> {
  await lockExistingPrismaUser(ctx.prisma, userId);
  const existing = await ctx.prisma.reminder.findFirst({
    where: { id, task: { userId } },
  });
  if (existing === null) {
    return null;
  }
  const before = toProtocolReminder(existing);
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.reminder.update({
    where: { id },
    data: buildReminderUpdateData(data, syncSeq),
  });
  const after = toProtocolReminder(updated);
  await recordPrismaMutation(ctx.prisma, {
    userId,
    syncSeq,
    entityType: "reminder",
    entityId: id,
    action: inferDeleteOrRestoreAction(
      before.is_deleted,
      after.is_deleted,
      ctx.audit?.actionHint,
    ),
    audit: ctx.audit,
    before,
    after,
  });
  return after;
}

export async function deletePrismaReminder(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
): Promise<boolean> {
  await lockExistingPrismaUser(ctx.prisma, userId);
  const existing = await ctx.prisma.reminder.findFirst({
    where: { id, task: { userId } },
  });
  if (existing === null) {
    return false;
  }
  const before = toProtocolReminder(existing);
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.reminder.update({
    where: { id },
    data: { isDeleted: true, syncSeq },
  });
  await recordPrismaMutation(ctx.prisma, {
    userId,
    syncSeq,
    entityType: "reminder",
    entityId: id,
    action: "delete",
    audit: ctx.audit,
    before,
    after: toProtocolReminder(updated),
  });
  return true;
}

export async function getPrismaReminder(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId?: string,
): Promise<Reminder | null> {
  const where: Prisma.ReminderWhereInput = { id };
  if (userId !== undefined && userId !== "") {
    where.task = { userId };
  }
  const row = await ctx.prisma.reminder.findFirst({ where });
  return row === null ? null : toProtocolReminder(row);
}

export async function listPrismaReminders(
  ctx: PrismaSecondaryCtx,
  filter: ListRemindersFilter,
): Promise<Reminder[]> {
  const where: Prisma.ReminderWhereInput = {
    task: { userId: filter.userId },
    ...buildSyncWhereClause(filter),
  };
  if (filter.taskId !== undefined && filter.taskId !== "") {
    where.taskId = filter.taskId;
  }
  const reminders = await ctx.prisma.reminder.findMany({ where });
  return reminders.map((r) => toProtocolReminder(r));
}

export async function createPrismaFilter(
  ctx: PrismaSecondaryCtx,
  data: CreateFilterInput,
): Promise<Filter> {
  const syncSeq = await ctx.nextSyncSeq(data.userId);
  const created = await ctx.prisma.filter.create({
    data: {
      id: data.id ?? crypto.randomUUID(),
      userId: data.userId,
      name: data.name,
      query: data.query,
      color: data.color ?? "charcoal",
      itemOrder: data.itemOrder ?? 0,
      isFavorite: data.isFavorite ?? false,
      syncSeq,
    },
  });
  const mapped = toProtocolFilter(created);
  await recordPrismaMutation(ctx.prisma, {
    userId: data.userId,
    syncSeq,
    entityType: "filter",
    entityId: mapped.id,
    action: ctx.audit?.actionHint ?? "create",
    audit: ctx.audit,
    before: null,
    after: mapped,
  });
  return mapped;
}

export async function updatePrismaFilter(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
  data: UpdateFilterInput,
): Promise<Filter | null> {
  await lockExistingPrismaUser(ctx.prisma, userId);
  const existing = await ctx.prisma.filter.findFirst({
    where: { id, userId },
  });
  if (existing === null) {
    return null;
  }
  const before = toProtocolFilter(existing);
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.filter.update({
    where: { id },
    data: buildFilterUpdateData(data, syncSeq),
  });
  const after = toProtocolFilter(updated);
  await recordPrismaMutation(ctx.prisma, {
    userId,
    syncSeq,
    entityType: "filter",
    entityId: id,
    action: inferDeleteOrRestoreAction(
      before.is_deleted,
      after.is_deleted,
      ctx.audit?.actionHint,
    ),
    audit: ctx.audit,
    before,
    after,
  });
  return after;
}

export async function deletePrismaFilter(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
): Promise<boolean> {
  await lockExistingPrismaUser(ctx.prisma, userId);
  const existing = await ctx.prisma.filter.findFirst({
    where: { id, userId },
  });
  if (existing === null) {
    return false;
  }
  const before = toProtocolFilter(existing);
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.filter.update({
    where: { id },
    data: { isDeleted: true, syncSeq },
  });
  await recordPrismaMutation(ctx.prisma, {
    userId,
    syncSeq,
    entityType: "filter",
    entityId: id,
    action: "delete",
    audit: ctx.audit,
    before,
    after: toProtocolFilter(updated),
  });
  return true;
}

export async function getPrismaFilter(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId?: string,
): Promise<Filter | null> {
  const where: Prisma.FilterWhereInput = { id };
  if (userId !== undefined && userId !== "") {
    where.userId = userId;
  }
  const row = await ctx.prisma.filter.findFirst({ where });
  return row === null ? null : toProtocolFilter(row);
}

export async function listPrismaFilters(
  ctx: PrismaSecondaryCtx,
  filter: ListFiltersFilter,
): Promise<Filter[]> {
  const where: Prisma.FilterWhereInput = {
    userId: filter.userId,
    ...buildSyncWhereClause(filter),
  };
  const filters = await ctx.prisma.filter.findMany({
    where,
    orderBy: { itemOrder: "asc" },
  });
  return filters.map((f) => toProtocolFilter(f));
}
