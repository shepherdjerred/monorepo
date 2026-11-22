import type { Prisma, PrismaClient } from "#generated/prisma/client.ts";
import type { Label, Project, Section } from "../../protocol/generated.ts";
import { inferDeleteOrRestoreAction } from "../audit-diff.ts";
import type { AuditContext } from "../auth-types.ts";
import {
  toProtocolLabel,
  toProtocolProject,
  toProtocolSection,
} from "../mappers.ts";
import {
  buildLabelUpdateData,
  buildProjectUpdateData,
  buildSectionUpdateData,
  buildSyncWhereClause,
} from "./prisma-helpers.ts";
import { recordPrismaMutation } from "./prisma-tokens-audit.ts";
import {
  type CreateLabelInput,
  type CreateProjectInput,
  type CreateSectionInput,
  EntityNotFoundError,
  type ListLabelsFilter,
  type ListProjectsFilter,
  type ListSectionsFilter,
  type UpdateLabelInput,
  type UpdateProjectInput,
  type UpdateSectionInput,
} from "../types.ts";

export type PrismaSecondaryCtx = {
  prisma: PrismaClient | Prisma.TransactionClient;
  audit: AuditContext | undefined;
  nextSyncSeq: (userId: string) => Promise<bigint>;
};

export async function createPrismaProject(
  ctx: PrismaSecondaryCtx,
  data: CreateProjectInput,
): Promise<Project> {
  const syncSeq = await ctx.nextSyncSeq(data.userId);
  const created = await ctx.prisma.project.create({
    data: {
      id: data.id ?? crypto.randomUUID(),
      userId: data.userId,
      name: data.name,
      color: data.color ?? "charcoal",
      parentId: data.parentId ?? null,
      childOrder: data.childOrder ?? 0,
      isInbox: data.isInbox ?? false,
      isFavorite: data.isFavorite ?? false,
      isArchived: data.isArchived ?? false,
      syncSeq,
    },
  });
  const mapped = toProtocolProject(created);
  await recordPrismaMutation(ctx.prisma, {
    userId: data.userId,
    syncSeq,
    entityType: "project",
    entityId: mapped.id,
    action: ctx.audit?.actionHint ?? "create",
    audit: ctx.audit,
    before: null,
    after: mapped,
  });
  return mapped;
}

export async function updatePrismaProject(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
  data: UpdateProjectInput,
): Promise<Project | null> {
  const existing = await ctx.prisma.project.findFirst({
    where: { id, userId },
  });
  if (existing === null) {
    return null;
  }
  const before = toProtocolProject(existing);
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.project.update({
    where: { id },
    data: buildProjectUpdateData(data, syncSeq),
  });
  const after = toProtocolProject(updated);
  await recordPrismaMutation(ctx.prisma, {
    userId,
    syncSeq,
    entityType: "project",
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

export async function deletePrismaProject(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
): Promise<boolean> {
  const existing = await ctx.prisma.project.findFirst({
    where: { id, userId },
  });
  if (existing === null) {
    return false;
  }
  const before = toProtocolProject(existing);
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.project.update({
    where: { id },
    data: { isDeleted: true, syncSeq },
  });
  await recordPrismaMutation(ctx.prisma, {
    userId,
    syncSeq,
    entityType: "project",
    entityId: id,
    action: "delete",
    audit: ctx.audit,
    before,
    after: toProtocolProject(updated),
  });
  return true;
}

export async function getPrismaProject(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId?: string,
): Promise<Project | null> {
  const where: Prisma.ProjectWhereInput = { id };
  if (userId !== undefined && userId !== "") {
    where.userId = userId;
  }
  const project = await ctx.prisma.project.findFirst({ where });
  return project === null ? null : toProtocolProject(project);
}

export async function listPrismaProjects(
  ctx: PrismaSecondaryCtx,
  filter: ListProjectsFilter,
): Promise<Project[]> {
  const where: Prisma.ProjectWhereInput = {
    userId: filter.userId,
    ...buildSyncWhereClause(filter),
  };
  const projects = await ctx.prisma.project.findMany({
    where,
    orderBy: { childOrder: "asc" },
  });
  return projects.map((p) => toProtocolProject(p));
}

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
  const mapped = toProtocolSection(created);
  await recordPrismaMutation(ctx.prisma, {
    userId: data.userId,
    syncSeq,
    entityType: "section",
    entityId: mapped.id,
    action: ctx.audit?.actionHint ?? "create",
    audit: ctx.audit,
    before: null,
    after: mapped,
  });
  return mapped;
}

export async function updatePrismaSection(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
  data: UpdateSectionInput,
): Promise<Section | null> {
  const existing = await ctx.prisma.section.findFirst({
    where: { id, userId },
  });
  if (existing === null) {
    return null;
  }
  const before = toProtocolSection(existing);
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.section.update({
    where: { id },
    data: buildSectionUpdateData(data, syncSeq),
  });
  const after = toProtocolSection(updated);
  await recordPrismaMutation(ctx.prisma, {
    userId,
    syncSeq,
    entityType: "section",
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

export async function deletePrismaSection(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
): Promise<boolean> {
  const existing = await ctx.prisma.section.findFirst({
    where: { id, userId },
  });
  if (existing === null) {
    return false;
  }
  const before = toProtocolSection(existing);
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.section.update({
    where: { id },
    data: { isDeleted: true, syncSeq },
  });
  await recordPrismaMutation(ctx.prisma, {
    userId,
    syncSeq,
    entityType: "section",
    entityId: id,
    action: "delete",
    audit: ctx.audit,
    before,
    after: toProtocolSection(updated),
  });
  return true;
}

export async function getPrismaSection(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId?: string,
): Promise<Section | null> {
  const where: Prisma.SectionWhereInput = { id };
  if (userId !== undefined && userId !== "") {
    where.userId = userId;
  }
  const row = await ctx.prisma.section.findFirst({ where });
  return row === null ? null : toProtocolSection(row);
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
  const mapped = toProtocolLabel(created);
  await recordPrismaMutation(ctx.prisma, {
    userId: data.userId,
    syncSeq,
    entityType: "label",
    entityId: mapped.id,
    action: ctx.audit?.actionHint ?? "create",
    audit: ctx.audit,
    before: null,
    after: mapped,
  });
  return mapped;
}

export async function updatePrismaLabel(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
  data: UpdateLabelInput,
): Promise<Label | null> {
  const existing = await ctx.prisma.label.findFirst({
    where: { id, userId },
  });
  if (existing === null) {
    return null;
  }
  const before = toProtocolLabel(existing);
  const syncSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.label.update({
    where: { id },
    data: buildLabelUpdateData(data, syncSeq),
  });
  const after = toProtocolLabel(updated);
  await recordPrismaMutation(ctx.prisma, {
    userId,
    syncSeq,
    entityType: "label",
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

export async function deletePrismaLabel(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId: string,
): Promise<boolean> {
  const existing = await ctx.prisma.label.findFirst({
    where: { id, userId },
  });
  if (existing === null) {
    return false;
  }
  const before = toProtocolLabel(existing);
  const affectedTasks = await ctx.prisma.task.findMany({
    where: { userId, labels: { some: { labelId: id } } },
    select: { id: true },
  });
  await ctx.prisma.taskLabel.deleteMany({
    where: { labelId: id, task: { userId } },
  });
  const labelSeq = await ctx.nextSyncSeq(userId);
  const updated = await ctx.prisma.label.update({
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
  await recordPrismaMutation(ctx.prisma, {
    userId,
    syncSeq: labelSeq,
    entityType: "label",
    entityId: id,
    action: "delete",
    audit: ctx.audit,
    before,
    after: toProtocolLabel(updated),
  });
  return true;
}

export async function getPrismaLabel(
  ctx: PrismaSecondaryCtx,
  id: string,
  userId?: string,
): Promise<Label | null> {
  const where: Prisma.LabelWhereInput = { id };
  if (userId !== undefined && userId !== "") {
    where.userId = userId;
  }
  const row = await ctx.prisma.label.findFirst({ where });
  return row === null ? null : toProtocolLabel(row);
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
