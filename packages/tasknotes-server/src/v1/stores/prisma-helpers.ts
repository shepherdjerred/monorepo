import type { Prisma, PrismaClient } from "#generated/prisma/client.ts";
import type { Task } from "../../protocol/generated.ts";
import { storageComment } from "../comments.ts";
import { toProtocolTask } from "../mappers.ts";
import {
  type BaseListFilter,
  type CreateTaskInput,
  EntityNotFoundError,
  type UpdateFilterInput,
  type UpdateLabelInput,
  type UpdateProjectInput,
  type UpdateReminderInput,
  type UpdateSectionInput,
  type UpdateTaskInput,
} from "../types.ts";

export async function lockExistingPrismaUser(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await prisma.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

export async function validatePrismaTaskRefs(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  refs: {
    projectId: string | undefined;
    sectionId: string | null | undefined;
    currentProjectId?: string | undefined;
    currentSectionId?: string | null | undefined;
  },
): Promise<void> {
  if (refs.projectId === undefined && refs.sectionId === undefined) {
    return;
  }
  if (refs.projectId !== undefined) {
    const found = await prisma.project.findFirst({
      where: { id: refs.projectId, userId },
      select: { id: true },
    });
    if (found === null) {
      throw new EntityNotFoundError("Project", refs.projectId);
    }
  }
  const effectiveProjectId = refs.projectId ?? refs.currentProjectId;
  const effectiveSectionId =
    refs.sectionId === undefined ? refs.currentSectionId : refs.sectionId;
  if (
    effectiveSectionId !== undefined &&
    effectiveSectionId !== null &&
    effectiveSectionId !== ""
  ) {
    const sec = await prisma.section.findFirst({
      where: { id: effectiveSectionId, userId },
      select: { id: true, projectId: true },
    });
    if (sec === null) {
      throw new EntityNotFoundError("Section", effectiveSectionId);
    }
    if (
      effectiveProjectId !== undefined &&
      sec.projectId !== effectiveProjectId
    ) {
      throw new TypeError(
        "The destination section must belong to the destination project.",
      );
    }
  }
}

export async function validatePrismaLabelIds(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  labelIds: string[],
): Promise<string[]> {
  const deduped = [...new Set(labelIds)];
  if (deduped.length === 0) {
    return [];
  }
  const existing = await prisma.label.findMany({
    where: { id: { in: deduped }, userId, isDeleted: false },
    select: { id: true },
  });
  const existingSet = new Set(existing.map((row) => row.id));
  for (const labelId of deduped) {
    if (!existingSet.has(labelId)) {
      throw new EntityNotFoundError("Label", labelId);
    }
  }
  return deduped;
}

export function buildPrismaTaskCreateData(
  data: CreateTaskInput,
  syncSeq: bigint,
  labelIds: string[],
): Prisma.TaskUncheckedCreateInput {
  return {
    id: data.id ?? crypto.randomUUID(),
    userId: data.userId,
    projectId: data.projectId,
    sectionId: data.sectionId ?? null,
    parentId: data.parentId ?? null,
    title: data.title,
    description: data.description ?? "",
    priority: data.priority ?? "P4",
    childOrder: data.childOrder ?? 0,
    dueDate: data.dueDate ?? null,
    dueDatetime: data.dueDatetime ?? null,
    dueTimezone: data.dueTimezone ?? null,
    dueString: data.dueString ?? null,
    isRecurring: data.isRecurring ?? false,
    deadline: data.deadline ?? null,
    recurrenceBasis: data.recurrenceBasis ?? null,
    recurrenceRule: data.recurrenceRule ?? null,
    completed: data.completed ?? false,
    completedAt: data.completedAt ?? null,
    syncSeq,
    ...(labelIds.length > 0
      ? { labels: { create: labelIds.map((labelId) => ({ labelId })) } }
      : {}),
  };
}

export const TASK_WITH_LABELS_INCLUDE = {
  comments: {
    select: { id: true, body: true, fileName: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  labels: {
    where: { label: { isDeleted: false } },
    select: { labelId: true },
  },
} satisfies Prisma.TaskInclude;

export type PrismaTaskWithLabels = Prisma.TaskGetPayload<{
  include: typeof TASK_WITH_LABELS_INCLUDE;
}>;

export function mapPrismaTask(row: PrismaTaskWithLabels): Task {
  const task = toProtocolTask(
    row,
    row.labels.map((entry) => entry.labelId),
  );
  if (row.comments.length > 0) {
    task.comments = row.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      created_at: comment.createdAt.toISOString(),
      ...(comment.fileName === null ? {} : { file_name: comment.fileName }),
    }));
  }
  return task;
}

export function sanitizeSavepointName(name: string): string {
  const cleaned = name.replaceAll(/\W/g, "_").slice(0, 48);
  return `sp_${cleaned === "" ? "cmd" : cleaned}`;
}

export function buildSyncWhereClause(filter: BaseListFilter): {
  isDeleted?: boolean;
  syncSeq?: { gt: bigint };
  updatedAt?: { gt: Date };
} {
  const clause: {
    isDeleted?: boolean;
    syncSeq?: { gt: bigint };
    updatedAt?: { gt: Date };
  } = {};
  if (filter.includeDeleted !== true) {
    clause.isDeleted = false;
  }
  if (filter.sinceSeq !== undefined) {
    clause.syncSeq = { gt: filter.sinceSeq };
  } else if (filter.since !== undefined) {
    clause.updatedAt = { gt: filter.since };
  }
  return clause;
}

function buildTaskUpdateBasic(
  data: UpdateTaskInput,
  target: Prisma.TaskUpdateInput,
): void {
  if (data.title !== undefined) {
    target.title = data.title;
  }
  if (data.description !== undefined) {
    target.description = data.description;
  }
  if (data.priority !== undefined) {
    target.priority = data.priority;
  }
  if (data.projectId !== undefined) {
    target.project = { connect: { id: data.projectId } };
  }
  if (data.sectionId !== undefined) {
    target.section =
      data.sectionId === null
        ? { disconnect: true }
        : { connect: { id: data.sectionId } };
  }
  if (data.parentId !== undefined) {
    target.parentId = data.parentId;
  }
  if (data.childOrder !== undefined) {
    target.childOrder = data.childOrder;
  }
}

function buildTaskUpdateDates(
  data: UpdateTaskInput,
  target: Prisma.TaskUpdateInput,
): void {
  if (data.dueDate !== undefined) {
    target.dueDate = data.dueDate;
  }
  if (data.dueDatetime !== undefined) {
    target.dueDatetime = data.dueDatetime;
  }
  if (data.dueTimezone !== undefined) {
    target.dueTimezone = data.dueTimezone;
  }
  if (data.dueString !== undefined) {
    target.dueString = data.dueString;
  }
  if (data.deadline !== undefined) target.deadline = data.deadline;
  if (data.recurrenceBasis !== undefined)
    target.recurrenceBasis = data.recurrenceBasis;
  if (data.isRecurring !== undefined) {
    target.isRecurring = data.isRecurring;
  }
  if (data.recurrenceRule !== undefined) {
    target.recurrenceRule = data.recurrenceRule;
  }
  if (data.completed !== undefined) {
    target.completed = data.completed;
  }
  if (data.completedAt !== undefined) {
    target.completedAt = data.completedAt;
  }
  if (data.isDeleted !== undefined) {
    target.isDeleted = data.isDeleted;
  }
}

export function buildTaskUpdateData(
  data: UpdateTaskInput,
  syncSeq: bigint,
  labelIds: string[] | undefined,
): Prisma.TaskUpdateInput {
  const updateData: Prisma.TaskUpdateInput = { syncSeq };
  if (data.appendComment !== undefined) {
    updateData.comments = { create: storageComment(data.appendComment) };
  } else if (data.removeCommentId !== undefined) {
    updateData.comments = { deleteMany: { id: data.removeCommentId } };
  } else if (data.removeAttachmentId !== undefined) {
    updateData.comments = {
      deleteMany: { id: data.removeAttachmentId, body: "" },
      updateMany: {
        where: { id: data.removeAttachmentId, body: { not: "" } },
        data: { attachment: null, fileName: null },
      },
    };
  }
  buildTaskUpdateBasic(data, updateData);
  buildTaskUpdateDates(data, updateData);
  if (labelIds !== undefined) {
    updateData.labels = {
      deleteMany: {},
      create: labelIds.map((labelId) => ({ labelId })),
    };
  }
  return updateData;
}

export function buildProjectUpdateData(
  data: UpdateProjectInput,
  syncSeq: bigint,
): Prisma.ProjectUpdateInput {
  const out: Prisma.ProjectUpdateInput = { syncSeq };
  if (data.name !== undefined) {
    out.name = data.name;
  }
  if (data.color !== undefined) {
    out.color = data.color;
  }
  if (data.parentId !== undefined) {
    out.parentId = data.parentId;
  }
  if (data.childOrder !== undefined) {
    out.childOrder = data.childOrder;
  }
  if (data.isFavorite !== undefined) {
    out.isFavorite = data.isFavorite;
  }
  if (data.isArchived !== undefined) {
    out.isArchived = data.isArchived;
  }
  if (data.isDeleted !== undefined) {
    out.isDeleted = data.isDeleted;
  }
  return out;
}

export function buildSectionUpdateData(
  data: UpdateSectionInput,
  syncSeq: bigint,
): Prisma.SectionUpdateInput {
  const out: Prisma.SectionUpdateInput = { syncSeq };
  if (data.name !== undefined) {
    out.name = data.name;
  }
  if (data.sectionOrder !== undefined) {
    out.sectionOrder = data.sectionOrder;
  }
  if (data.isArchived !== undefined) {
    out.isArchived = data.isArchived;
  }
  if (data.isDeleted !== undefined) {
    out.isDeleted = data.isDeleted;
  }
  return out;
}

function buildOrderedColorItemUpdate(
  data: UpdateLabelInput,
  syncSeq: bigint,
): {
  syncSeq: bigint;
  name?: string;
  color?: string;
  itemOrder?: number;
  isFavorite?: boolean;
  isDeleted?: boolean;
} {
  const out: {
    syncSeq: bigint;
    name?: string;
    color?: string;
    itemOrder?: number;
    isFavorite?: boolean;
    isDeleted?: boolean;
  } = { syncSeq };
  if (data.name !== undefined) {
    out.name = data.name;
  }
  if (data.color !== undefined) {
    out.color = data.color;
  }
  if (data.itemOrder !== undefined) {
    out.itemOrder = data.itemOrder;
  }
  if (data.isFavorite !== undefined) {
    out.isFavorite = data.isFavorite;
  }
  if (data.isDeleted !== undefined) {
    out.isDeleted = data.isDeleted;
  }
  return out;
}

export function buildLabelUpdateData(
  data: UpdateLabelInput,
  syncSeq: bigint,
): Prisma.LabelUpdateInput {
  return buildOrderedColorItemUpdate(data, syncSeq);
}

export function buildReminderUpdateData(
  data: UpdateReminderInput,
  syncSeq: bigint,
): Prisma.ReminderUpdateInput {
  const out: Prisma.ReminderUpdateInput = { syncSeq };
  if (data.reminderType !== undefined) {
    out.reminderType = data.reminderType;
  }
  if (data.minuteOffset !== undefined) {
    out.minuteOffset = data.minuteOffset;
  }
  if (data.dueDatetime !== undefined) {
    out.dueDatetime = data.dueDatetime;
  }
  if (data.isNotified !== undefined) {
    out.isNotified = data.isNotified;
  }
  if (data.isDeleted !== undefined) {
    out.isDeleted = data.isDeleted;
  }
  return out;
}

export function buildFilterUpdateData(
  data: UpdateFilterInput,
  syncSeq: bigint,
): Prisma.FilterUpdateInput {
  const out: Prisma.FilterUpdateInput = buildOrderedColorItemUpdate(
    data,
    syncSeq,
  );
  if (data.query !== undefined) {
    out.query = data.query;
  }
  return out;
}
