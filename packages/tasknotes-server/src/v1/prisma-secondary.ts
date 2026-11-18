import type { Prisma, PrismaClient } from "#generated/prisma/client.ts";
import type {
  Filter,
  Label,
  Reminder,
  Section,
} from "../protocol/generated.ts";
import {
  toProtocolFilter,
  toProtocolLabel,
  toProtocolReminder,
  toProtocolSection,
} from "./mappers.ts";
import {
  buildFilterUpdateData,
  buildLabelUpdateData,
  buildReminderUpdateData,
  buildSectionUpdateData,
  buildSyncWhereClause,
} from "./prisma-helpers.ts";
import {
  type CreateFilterInput,
  type CreateLabelInput,
  type CreateReminderInput,
  type CreateSectionInput,
  EntityNotFoundError,
  type ListFiltersFilter,
  type ListLabelsFilter,
  type ListRemindersFilter,
  type ListSectionsFilter,
  type UpdateFilterInput,
  type UpdateLabelInput,
  type UpdateReminderInput,
  type UpdateSectionInput,
} from "./types.ts";

export type PrismaSecondaryCtx = {
  prisma: PrismaClient | Prisma.TransactionClient;
  nextSyncSeq: (userId: string) => Promise<bigint>;
};

export async function createPrismaSection(
  ctx: PrismaSecondaryCtx,
  data: CreateSectionInput,
): Promise<Section> {
  const proj = await ctx.prisma.project.findFirst({
    where: { id: data.projectId, userId: data.userId },
    select: { id: true },
  });
  if (proj === null) {
    throw new EntityNotFoundError("Project", data.projectId);
  }
  const syncSeq = await ctx.nextSyncSeq(data.userId);
  const created = await ctx.prisma.section.create({
    data: {
      id: data.id ?? crypto.randomUUID(),
      userId: data.userId,
      projectId: data.projectId,
      name: data.name,
      sectionOrder: data.sectionOrder ?? 0,
      syncSeq,
    },
  });
  return toProtocolSection(created);
}

export async function updatePrismaSection(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
  data: UpdateSectionInput,
): Promise<Section | null> {
  const existing = await ctx.prisma.section.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (existing === null) {
    return null;
  }
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.section.update({
    where: { id },
    data: buildSectionUpdateData(data, syncSeq),
  });
  return toProtocolSection(updated);
}

export async function deletePrismaSection(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
): Promise<boolean> {
  const existing = await ctx.prisma.section.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (existing === null) {
    return false;
  }
  const syncSeq = await ctx.nextSyncSeq(userId);
  await ctx.prisma.section.update({
    where: { id },
    data: { isDeleted: true, syncSeq },
  });
  return true;
}

export async function listPrismaSections(
  ctx: PrismaSecondaryCtx,
  filter: ListSectionsFilter,
): Promise<Section[]> {
  const where: Prisma.SectionWhereInput = {
    userId: filter.userId,
    ...buildSyncWhereClause(filter),
  };
  if (filter.projectId !== undefined && filter.projectId !== "") {
    where.projectId = filter.projectId;
  }
  const sections = await ctx.prisma.section.findMany({
    where,
    orderBy: { sectionOrder: "asc" },
  });
  return sections.map((s) => toProtocolSection(s));
}

export async function createPrismaLabel(
  ctx: PrismaSecondaryCtx,
  data: CreateLabelInput,
): Promise<Label> {
  const syncSeq = await ctx.nextSyncSeq(data.userId);
  const created = await ctx.prisma.label.create({
    data: {
      id: data.id ?? crypto.randomUUID(),
      userId: data.userId,
      name: data.name,
      color: data.color ?? "grey",
      itemOrder: data.itemOrder ?? 0,
      isFavorite: data.isFavorite ?? false,
      syncSeq,
    },
  });
  return toProtocolLabel(created);
}

export async function updatePrismaLabel(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
  data: UpdateLabelInput,
): Promise<Label | null> {
  const existing = await ctx.prisma.label.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (existing === null) {
    return null;
  }
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.label.update({
    where: { id },
    data: buildLabelUpdateData(data, syncSeq),
  });
  return toProtocolLabel(updated);
}

export async function deletePrismaLabel(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
): Promise<boolean> {
  const existing = await ctx.prisma.label.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (existing === null) {
    return false;
  }
  const affectedTasks = await ctx.prisma.task.findMany({
    where: { userId, labels: { some: { labelId: id } } },
    select: { id: true },
  });
  await ctx.prisma.taskLabel.deleteMany({
    where: { labelId: id, task: { userId } },
  });
  const labelSeq = await ctx.nextSyncSeq(userId);
  await ctx.prisma.label.update({
    where: { id },
    data: { isDeleted: true, syncSeq: labelSeq },
  });
  for (const affected of affectedTasks) {
    const taskSeq = await ctx.nextSyncSeq(userId);
    await ctx.prisma.task.update({
      where: { id: affected.id },
      data: { syncSeq: taskSeq },
    });
  }
  return true;
}

export async function listPrismaLabels(
  ctx: PrismaSecondaryCtx,
  filter: ListLabelsFilter,
): Promise<Label[]> {
  const where: Prisma.LabelWhereInput = {
    userId: filter.userId,
    ...buildSyncWhereClause(filter),
  };
  const labels = await ctx.prisma.label.findMany({
    where,
    orderBy: { itemOrder: "asc" },
  });
  return labels.map((l) => toProtocolLabel(l));
}

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
  return toProtocolReminder(created);
}

export async function updatePrismaReminder(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
  data: UpdateReminderInput,
): Promise<Reminder | null> {
  const existing = await ctx.prisma.reminder.findFirst({
    where: { id, task: { userId } },
    select: { id: true },
  });
  if (existing === null) {
    return null;
  }
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.reminder.update({
    where: { id },
    data: buildReminderUpdateData(data, syncSeq),
  });
  return toProtocolReminder(updated);
}

export async function deletePrismaReminder(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
): Promise<boolean> {
  const existing = await ctx.prisma.reminder.findFirst({
    where: { id, task: { userId } },
    select: { id: true },
  });
  if (existing === null) {
    return false;
  }
  const syncSeq = await ctx.nextSyncSeq(userId);
  await ctx.prisma.reminder.update({
    where: { id },
    data: { isDeleted: true, syncSeq },
  });
  return true;
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
  return toProtocolFilter(created);
}

export async function updatePrismaFilter(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
  data: UpdateFilterInput,
): Promise<Filter | null> {
  const existing = await ctx.prisma.filter.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (existing === null) {
    return null;
  }
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.filter.update({
    where: { id },
    data: buildFilterUpdateData(data, syncSeq),
  });
  return toProtocolFilter(updated);
}

export async function deletePrismaFilter(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
): Promise<boolean> {
  const existing = await ctx.prisma.filter.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (existing === null) {
    return false;
  }
  const syncSeq = await ctx.nextSyncSeq(userId);
  await ctx.prisma.filter.update({
    where: { id },
    data: { isDeleted: true, syncSeq },
  });
  return true;
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
