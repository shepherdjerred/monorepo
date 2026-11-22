import type { Prisma, PrismaClient } from "#generated/prisma/client.ts";
import type { Task } from "../../protocol/generated.ts";
import { inferTaskUpdateAction } from "../audit-diff.ts";
import type { AuditContext } from "../auth-types.ts";
import { recordTaskMutationMetric } from "../mappers.ts";
import { buildTaskCompletionUpdate } from "../recurrence.ts";
import {
  buildPrismaTaskCreateData,
  buildSyncWhereClause,
  buildTaskUpdateData,
  lockExistingPrismaUser,
  mapPrismaTask,
  TASK_WITH_LABELS_INCLUDE,
  validatePrismaLabelIds,
  validatePrismaTaskRefs,
} from "./prisma-helpers.ts";
import { recordPrismaMutation } from "./prisma-tokens-audit.ts";
import type * as V1 from "../types.ts";

export type PrismaTaskCtx = {
  prisma: PrismaClient | Prisma.TransactionClient;
  audit: AuditContext | undefined;
  nextSyncSeq: (userId: string) => Promise<bigint>;
};

export async function createPrismaTask(
  ctx: PrismaTaskCtx,
  data: V1.CreateTaskInput,
): Promise<Task> {
  await validatePrismaTaskRefs(ctx.prisma, data.userId, {
    projectId: data.projectId,
    sectionId: data.sectionId,
  });
  const labelIds =
    data.labelIds === undefined
      ? []
      : await validatePrismaLabelIds(ctx.prisma, data.userId, data.labelIds);
  const syncSeq = await ctx.nextSyncSeq(data.userId);
  const created = await ctx.prisma.task.create({
    data: buildPrismaTaskCreateData(data, syncSeq, labelIds),
    include: TASK_WITH_LABELS_INCLUDE,
  });
  const mapped = mapPrismaTask(created);
  await recordPrismaMutation(ctx.prisma, {
    userId: data.userId,
    syncSeq,
    entityType: "task",
    entityId: mapped.id,
    action: ctx.audit?.actionHint ?? "create",
    audit: ctx.audit,
    before: null,
    after: mapped,
  });
  recordTaskMutationMetric("created");
  return mapped;
}

export async function updatePrismaTask(
  ctx: PrismaTaskCtx,
  id: string,
  userId: string,
  data: V1.UpdateTaskInput,
): Promise<Task | null> {
  await lockExistingPrismaUser(ctx.prisma, userId);
  const existing = await ctx.prisma.task.findFirst({
    where: { id, userId },
    include: TASK_WITH_LABELS_INCLUDE,
  });
  if (existing === null) {
    return null;
  }
  const before = mapPrismaTask(existing);
  await validatePrismaTaskRefs(ctx.prisma, userId, {
    projectId: data.projectId,
    sectionId: data.sectionId,
    currentProjectId: existing.projectId,
    currentSectionId: existing.sectionId,
  });
  const labelIds =
    data.labelIds === undefined
      ? undefined
      : await validatePrismaLabelIds(ctx.prisma, userId, data.labelIds);
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.task.update({
    where: { id },
    data: buildTaskUpdateData(data, syncSeq, labelIds),
    include: TASK_WITH_LABELS_INCLUDE,
  });
  const after = mapPrismaTask(updated);
  await recordPrismaMutation(ctx.prisma, {
    userId,
    syncSeq,
    entityType: "task",
    entityId: id,
    action: inferTaskUpdateAction(before, after, data, ctx.audit?.actionHint),
    audit: ctx.audit,
    before,
    after,
  });
  recordTaskMutationMetric(data.isDeleted === true ? "deleted" : "updated");
  return after;
}

export async function completePrismaTask(
  ctx: PrismaTaskCtx,
  id: string,
  userId: string,
  completedAt: Date,
): Promise<Task | null> {
  await lockExistingPrismaUser(ctx.prisma, userId);
  const existing = await ctx.prisma.task.findFirst({
    where: { id, userId },
    include: TASK_WITH_LABELS_INCLUDE,
  });
  if (existing === null || existing.isDeleted) {
    return null;
  }
  const before = mapPrismaTask(existing);
  const update = buildTaskCompletionUpdate(before, completedAt);
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.task.update({
    where: { id },
    data: buildTaskUpdateData(update, syncSeq, undefined),
    include: TASK_WITH_LABELS_INCLUDE,
  });
  const after = mapPrismaTask(updated);
  await recordPrismaMutation(ctx.prisma, {
    userId,
    syncSeq,
    entityType: "task",
    entityId: id,
    action: inferTaskUpdateAction(
      before,
      after,
      update,
      ctx.audit?.actionHint ?? "complete",
    ),
    audit: ctx.audit,
    before,
    after,
  });
  recordTaskMutationMetric("updated");
  return after;
}

export async function deletePrismaTask(
  ctx: PrismaTaskCtx,
  id: string,
  userId: string,
): Promise<boolean> {
  await lockExistingPrismaUser(ctx.prisma, userId);
  const existing = await ctx.prisma.task.findFirst({
    where: { id, userId },
    include: TASK_WITH_LABELS_INCLUDE,
  });
  if (existing === null) {
    return false;
  }
  const before = mapPrismaTask(existing);
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.task.update({
    where: { id },
    data: { isDeleted: true, syncSeq },
    include: TASK_WITH_LABELS_INCLUDE,
  });
  await recordPrismaMutation(ctx.prisma, {
    userId,
    syncSeq,
    entityType: "task",
    entityId: id,
    action: "delete",
    audit: ctx.audit,
    before,
    after: mapPrismaTask(updated),
  });
  recordTaskMutationMetric("deleted");
  return true;
}

export async function getPrismaTask(
  prisma: PrismaClient | Prisma.TransactionClient,
  id: string,
  userId?: string,
): Promise<Task | null> {
  const where: Prisma.TaskWhereInput = { id };
  if (userId !== undefined && userId !== "") {
    where.userId = userId;
  }
  const task = await prisma.task.findFirst({
    where,
    include: TASK_WITH_LABELS_INCLUDE,
  });
  return task === null ? null : mapPrismaTask(task);
}

export async function listPrismaTasks(
  prisma: PrismaClient | Prisma.TransactionClient,
  filter: V1.ListTasksFilter,
): Promise<Task[]> {
  const where: Prisma.TaskWhereInput = {
    userId: filter.userId,
    ...buildSyncWhereClause(filter),
  };
  if (filter.projectId !== undefined && filter.projectId !== "") {
    where.projectId = filter.projectId;
  }
  const tasks = await prisma.task.findMany({
    where,
    orderBy: { childOrder: "asc" },
    include: TASK_WITH_LABELS_INCLUDE,
  });
  return tasks.map((task) => mapPrismaTask(task));
}
