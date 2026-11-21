import type { Prisma, PrismaClient } from "#generated/prisma/client.ts";
import type {
  Filter,
  Label,
  Project,
  Reminder,
  Section,
  Task,
} from "../protocol/generated.ts";
import { recordTaskMutationMetric, toProtocolProject } from "./mappers.ts";
import {
  buildProjectUpdateData,
  buildSyncWhereClause,
  buildTaskUpdateData,
  mapPrismaTask,
  sanitizeSavepointName,
  TASK_WITH_LABELS_INCLUDE,
} from "./prisma-helpers.ts";
import {
  createPrismaFilter,
  createPrismaLabel,
  createPrismaReminder,
  createPrismaSection,
  deletePrismaFilter,
  deletePrismaLabel,
  deletePrismaReminder,
  deletePrismaSection,
  listPrismaFilters,
  listPrismaLabels,
  listPrismaReminders,
  listPrismaSections,
  type PrismaSecondaryCtx,
  updatePrismaFilter,
  updatePrismaLabel,
  updatePrismaReminder,
  updatePrismaSection,
} from "./prisma-secondary.ts";
import { EntityNotFoundError } from "./types.ts";
import type * as V1 from "./types.ts";

export class PrismaFacetStore implements V1.FacetStore {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
    private readonly inTransaction = false,
  ) {}

  private secondaryCtx(): PrismaSecondaryCtx {
    return {
      prisma: this.prisma,
      nextSyncSeq: (uid) => this.nextSyncSeq(uid),
    };
  }

  private async nextSyncSeq(userId: string): Promise<bigint> {
    const user = await this.prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: `${userId}@tasknotes.local`,
        name: "Default User",
        syncSequence: 1n,
      },
      update: { syncSequence: { increment: 1 } },
      select: { syncSequence: true },
    });
    return user.syncSequence;
  }

  private async validateTaskRefs(
    userId: string,
    projectId: string | undefined,
    sectionId: string | null | undefined,
  ): Promise<void> {
    if (projectId !== undefined) {
      const found = await this.prisma.project.findFirst({
        where: { id: projectId, userId },
        select: { id: true },
      });
      if (found === null) {
        throw new EntityNotFoundError("Project", projectId);
      }
    }
    if (sectionId !== undefined && sectionId !== null && sectionId !== "") {
      const sec = await this.prisma.section.findFirst({
        where: { id: sectionId, userId },
        select: { id: true },
      });
      if (sec === null) {
        throw new EntityNotFoundError("Section", sectionId);
      }
    }
  }

  private async validateLabelIds(
    userId: string,
    labelIds: string[],
  ): Promise<string[]> {
    const deduped = [...new Set(labelIds)];
    if (deduped.length === 0) {
      return [];
    }
    const existing = await this.prisma.label.findMany({
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

  getNow(): Date {
    return new Date();
  }

  async transaction<T>(fn: (tx: V1.FacetStore) => Promise<T>): Promise<T> {
    return !this.inTransaction && "$transaction" in this.prisma
      ? await this.prisma.$transaction(
          async (txClient: Prisma.TransactionClient) =>
            await fn(new PrismaFacetStore(txClient, true)),
        )
      : await fn(this);
  }

  async runInSavepoint<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!this.inTransaction && "$transaction" in this.prisma) {
      return await this.prisma.$transaction(
        async (txClient) =>
          await new PrismaFacetStore(txClient, true).runInSavepoint(name, fn),
      );
    }
    const safeName = sanitizeSavepointName(name);
    await this.prisma.$executeRawUnsafe(`SAVEPOINT ${safeName}`);
    try {
      const result = await fn();
      await this.prisma.$executeRawUnsafe(`RELEASE SAVEPOINT ${safeName}`);
      return result;
    } catch (error: unknown) {
      await this.prisma.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${safeName}`);
      await this.prisma.$executeRawUnsafe(`RELEASE SAVEPOINT ${safeName}`);
      throw error;
    }
  }

  async getOrCreateUser(
    userId: string,
  ): Promise<{ id: string; email: string; name: string }> {
    const user = await this.prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: `${userId}@tasknotes.local`,
        name: "Default User",
      },
      update: {},
    });
    const existingInbox = await this.prisma.project.findFirst({
      where: { userId, isInbox: true, isDeleted: false },
      select: { id: true },
    });
    if (existingInbox === null) {
      await this.createProject({ userId, name: "Inbox", isInbox: true });
    }
    return { id: user.id, email: user.email, name: user.name };
  }

  async getSyncSequence(userId: string): Promise<bigint> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { syncSequence: true },
    });
    return user?.syncSequence ?? 0n;
  }

  async getProcessedCommand(
    uuid: string,
  ): Promise<V1.ProcessedCommandRecord | null> {
    return await this.prisma.processedCommand.findUnique({
      where: { uuid },
      select: { status: true, resultId: true },
    });
  }

  async recordProcessedCommand(
    uuid: string,
    userId: string,
    status: string,
    resultId: string | null = null,
  ): Promise<void> {
    await this.prisma.processedCommand.upsert({
      where: { uuid },
      create: { uuid, userId, status, resultId },
      update: { status, resultId },
    });
  }

  async countActiveTasks(): Promise<number> {
    return await this.prisma.task.count({ where: { isDeleted: false } });
  }

  async createTask(data: V1.CreateTaskInput): Promise<Task> {
    await this.validateTaskRefs(data.userId, data.projectId, data.sectionId);
    const labelIds =
      data.labelIds === undefined
        ? []
        : await this.validateLabelIds(data.userId, data.labelIds);
    const syncSeq = await this.nextSyncSeq(data.userId);
    const created = await this.prisma.task.create({
      data: {
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
      },
      include: TASK_WITH_LABELS_INCLUDE,
    });
    recordTaskMutationMetric("created");
    return mapPrismaTask(created);
  }

  async updateTask(
    id: string,
    userId: string,
    data: V1.UpdateTaskInput,
  ): Promise<Task | null> {
    const existing = await this.prisma.task.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (existing === null) {
      return null;
    }
    await this.validateTaskRefs(userId, data.projectId, data.sectionId);
    const labelIds =
      data.labelIds === undefined
        ? undefined
        : await this.validateLabelIds(userId, data.labelIds);
    const syncSeq = await this.nextSyncSeq(userId);
    const updated = await this.prisma.task.update({
      where: { id },
      data: buildTaskUpdateData(data, syncSeq, labelIds),
      include: TASK_WITH_LABELS_INCLUDE,
    });
    recordTaskMutationMetric(data.isDeleted === true ? "deleted" : "updated");
    return mapPrismaTask(updated);
  }

  async deleteTask(id: string, userId: string): Promise<boolean> {
    const existing = await this.prisma.task.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (existing === null) {
      return false;
    }
    const syncSeq = await this.nextSyncSeq(userId);
    await this.prisma.task.update({
      where: { id },
      data: { isDeleted: true, syncSeq },
    });
    recordTaskMutationMetric("deleted");
    return true;
  }

  async getAttachment(
    taskId: string,
    commentId: string,
    userId: string,
  ): Promise<Uint8Array<ArrayBuffer> | null> {
    const row = await this.prisma.taskComment.findFirst({
      where: { taskId, id: commentId, task: { userId, isDeleted: false } },
      select: { attachment: true },
    });
    return row?.attachment ?? null;
  }

  async getTask(id: string, userId?: string): Promise<Task | null> {
    const where: Prisma.TaskWhereInput = { id };
    if (userId !== undefined && userId !== "") {
      where.userId = userId;
    }
    const task = await this.prisma.task.findFirst({
      where,
      include: TASK_WITH_LABELS_INCLUDE,
    });
    return task === null ? null : mapPrismaTask(task);
  }

  async listTasks(filter: V1.ListTasksFilter): Promise<Task[]> {
    const where: Prisma.TaskWhereInput = {
      userId: filter.userId,
      ...buildSyncWhereClause(filter),
    };
    if (filter.projectId !== undefined && filter.projectId !== "") {
      where.projectId = filter.projectId;
    }
    const tasks = await this.prisma.task.findMany({
      where,
      orderBy: { childOrder: "asc" },
      include: TASK_WITH_LABELS_INCLUDE,
    });
    return tasks.map((task) => mapPrismaTask(task));
  }

  async createProject(data: V1.CreateProjectInput): Promise<Project> {
    const syncSeq = await this.nextSyncSeq(data.userId);
    const created = await this.prisma.project.create({
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
    return toProtocolProject(created);
  }

  async updateProject(
    id: string,
    userId: string,
    data: V1.UpdateProjectInput,
  ): Promise<Project | null> {
    const existing = await this.prisma.project.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (existing === null) {
      return null;
    }
    const syncSeq = await this.nextSyncSeq(userId);
    const updated = await this.prisma.project.update({
      where: { id },
      data: buildProjectUpdateData(data, syncSeq),
    });
    return toProtocolProject(updated);
  }

  async deleteProject(id: string, userId: string): Promise<boolean> {
    const existing = await this.prisma.project.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (existing === null) {
      return false;
    }
    const syncSeq = await this.nextSyncSeq(userId);
    await this.prisma.project.update({
      where: { id },
      data: { isDeleted: true, syncSeq },
    });
    return true;
  }

  async getProject(id: string, userId?: string): Promise<Project | null> {
    const where: Prisma.ProjectWhereInput = { id };
    if (userId !== undefined && userId !== "") {
      where.userId = userId;
    }
    const project = await this.prisma.project.findFirst({ where });
    return project === null ? null : toProtocolProject(project);
  }

  async listProjects(filter: V1.ListProjectsFilter): Promise<Project[]> {
    const where: Prisma.ProjectWhereInput = {
      userId: filter.userId,
      ...buildSyncWhereClause(filter),
    };
    const projects = await this.prisma.project.findMany({
      where,
      orderBy: { childOrder: "asc" },
    });
    return projects.map((p) => toProtocolProject(p));
  }

  async createSection(data: V1.CreateSectionInput): Promise<Section> {
    return await createPrismaSection(this.secondaryCtx(), data);
  }

  async updateSection(
    id: string,
    userId: string,
    data: V1.UpdateSectionInput,
  ): Promise<Section | null> {
    return await updatePrismaSection(this.secondaryCtx(), id, userId, data);
  }

  async deleteSection(id: string, userId: string): Promise<boolean> {
    return await deletePrismaSection(this.secondaryCtx(), id, userId);
  }

  async listSections(filter: V1.ListSectionsFilter): Promise<Section[]> {
    return await listPrismaSections(this.secondaryCtx(), filter);
  }

  async createLabel(data: V1.CreateLabelInput): Promise<Label> {
    return await createPrismaLabel(this.secondaryCtx(), data);
  }

  updateLabel(
    id: string,
    userId: string,
    data: V1.UpdateLabelInput,
  ): Promise<Label | null> {
    return updatePrismaLabel(this.secondaryCtx(), id, userId, data);
  }

  deleteLabel(id: string, userId: string): Promise<boolean> {
    return deletePrismaLabel(this.secondaryCtx(), id, userId);
  }

  listLabels(filter: V1.ListLabelsFilter): Promise<Label[]> {
    return listPrismaLabels(this.secondaryCtx(), filter);
  }

  createReminder(data: V1.CreateReminderInput): Promise<Reminder> {
    return createPrismaReminder(this.secondaryCtx(), data);
  }

  updateReminder(
    id: string,
    userId: string,
    data: V1.UpdateReminderInput,
  ): Promise<Reminder | null> {
    return updatePrismaReminder(this.secondaryCtx(), id, userId, data);
  }

  deleteReminder(id: string, userId: string): Promise<boolean> {
    return deletePrismaReminder(this.secondaryCtx(), id, userId);
  }

  listReminders(filter: V1.ListRemindersFilter): Promise<Reminder[]> {
    return listPrismaReminders(this.secondaryCtx(), filter);
  }

  createFilter(data: V1.CreateFilterInput): Promise<Filter> {
    return createPrismaFilter(this.secondaryCtx(), data);
  }

  updateFilter(
    id: string,
    userId: string,
    data: V1.UpdateFilterInput,
  ): Promise<Filter | null> {
    return updatePrismaFilter(this.secondaryCtx(), id, userId, data);
  }

  deleteFilter(id: string, userId: string): Promise<boolean> {
    return deletePrismaFilter(this.secondaryCtx(), id, userId);
  }

  listFilters(filter: V1.ListFiltersFilter): Promise<Filter[]> {
    return listPrismaFilters(this.secondaryCtx(), filter);
  }
}
