import type { Prisma, PrismaClient } from "#generated/prisma/client.ts";
import type {
  Filter,
  Label,
  Project,
  Reminder,
  Section,
  Task,
} from "../../protocol/generated.ts";
import { inferTaskUpdateAction } from "../audit-diff.ts";
import type {
  ApiTokenSummary,
  AuditContext,
  AuthenticatedApiToken,
  CreateApiTokenInput,
  ListMutationsFilter,
  MutationPage,
} from "../auth-types.ts";
import { recordTaskMutationMetric } from "../mappers.ts";
import {
  buildPrismaTaskCreateData,
  buildSyncWhereClause,
  buildTaskUpdateData,
  mapPrismaTask,
  sanitizeSavepointName,
  TASK_WITH_LABELS_INCLUDE,
  validatePrismaLabelIds,
  validatePrismaTaskRefs,
} from "./prisma-helpers.ts";
import {
  createPrismaFilter,
  createPrismaReminder,
  deletePrismaFilter,
  deletePrismaReminder,
  getPrismaFilter,
  getPrismaReminder,
  listPrismaFilters,
  listPrismaReminders,
  updatePrismaFilter,
  updatePrismaReminder,
} from "./prisma-reminders-filters.ts";
import {
  createPrismaLabel,
  createPrismaProject,
  createPrismaSection,
  deletePrismaLabel,
  deletePrismaProject,
  deletePrismaSection,
  getPrismaLabel,
  getPrismaProject,
  getPrismaSection,
  listPrismaLabels,
  listPrismaProjects,
  listPrismaSections,
  type PrismaSecondaryCtx,
  updatePrismaLabel,
  updatePrismaProject,
  updatePrismaSection,
} from "./prisma-secondary.ts";
import {
  authenticatePrismaApiToken,
  createPrismaApiToken,
  listPrismaApiTokens,
  listPrismaMutations,
  recordPrismaMutation,
  revokePrismaApiToken,
} from "./prisma-tokens-audit.ts";
import type * as V1 from "../types.ts";

export class PrismaFacetStore implements V1.FacetStore {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
    private readonly inTransaction = false,
    private readonly auditContext?: AuditContext,
  ) {}

  private secondaryCtx(): PrismaSecondaryCtx {
    return {
      prisma: this.prisma,
      audit: this.auditContext,
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

  getNow(): Date {
    return new Date();
  }
  withAuditContext(ctx: AuditContext | undefined): V1.FacetStore {
    return new PrismaFacetStore(this.prisma, this.inTransaction, ctx);
  }
  getAuditContext(): AuditContext | undefined {
    return this.auditContext;
  }

  async transaction<T>(fn: (tx: V1.FacetStore) => Promise<T>): Promise<T> {
    return !this.inTransaction && "$transaction" in this.prisma
      ? await this.prisma.$transaction(
          async (txClient: Prisma.TransactionClient) =>
            await fn(new PrismaFacetStore(txClient, true, this.auditContext)),
        )
      : await fn(this);
  }

  async runInSavepoint<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!this.inTransaction && "$transaction" in this.prisma) {
      return await this.prisma.$transaction(
        async (txClient) =>
          await new PrismaFacetStore(
            txClient,
            true,
            this.auditContext,
          ).runInSavepoint(name, fn),
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
      await this.withAuditContext(undefined).createProject({
        userId,
        name: "Inbox",
        isInbox: true,
      });
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
    const tokenId = this.auditContext?.tokenId ?? null;
    const actorName = this.auditContext?.actorName ?? null;
    const actorKind = this.auditContext?.actorKind ?? null;
    await this.prisma.processedCommand.upsert({
      where: { uuid },
      create: { uuid, userId, status, resultId, tokenId, actorName, actorKind },
      update: { status, resultId, tokenId, actorName, actorKind },
    });
  }

  createApiToken(data: CreateApiTokenInput): Promise<ApiTokenSummary> {
    return createPrismaApiToken(this.prisma, data);
  }
  listApiTokens(
    userId: string,
    options?: { includeRevoked?: boolean | undefined },
  ): Promise<ApiTokenSummary[]> {
    return listPrismaApiTokens(this.prisma, userId, options);
  }
  revokeApiToken(id: string, userId: string): Promise<ApiTokenSummary | null> {
    return revokePrismaApiToken(this.prisma, id, userId, this.getNow());
  }
  authenticateApiToken(
    tokenHash: string,
  ): Promise<AuthenticatedApiToken | null> {
    return authenticatePrismaApiToken(this.prisma, tokenHash, this.getNow());
  }
  listMutations(filter: ListMutationsFilter): Promise<MutationPage> {
    return listPrismaMutations(this.prisma, filter);
  }

  async countActiveTasks(): Promise<number> {
    return await this.prisma.task.count({ where: { isDeleted: false } });
  }

  async createTask(data: V1.CreateTaskInput): Promise<Task> {
    await validatePrismaTaskRefs(
      this.prisma,
      data.userId,
      data.projectId,
      data.sectionId,
    );
    const labelIds =
      data.labelIds === undefined
        ? []
        : await validatePrismaLabelIds(this.prisma, data.userId, data.labelIds);
    const syncSeq = await this.nextSyncSeq(data.userId);
    const created = await this.prisma.task.create({
      data: buildPrismaTaskCreateData(data, syncSeq, labelIds),
      include: TASK_WITH_LABELS_INCLUDE,
    });
    recordTaskMutationMetric("created");
    const mapped = mapPrismaTask(created);
    await recordPrismaMutation(this.prisma, {
      userId: data.userId,
      syncSeq,
      entityType: "task",
      entityId: mapped.id,
      action: this.auditContext?.actionHint ?? "create",
      audit: this.auditContext,
      before: null,
      after: mapped,
    });
    return mapped;
  }

  async updateTask(
    id: string,
    userId: string,
    data: V1.UpdateTaskInput,
  ): Promise<Task | null> {
    const existing = await this.prisma.task.findFirst({
      where: { id, userId },
      include: TASK_WITH_LABELS_INCLUDE,
    });
    if (existing === null) {
      return null;
    }
    const before = mapPrismaTask(existing);
    await validatePrismaTaskRefs(
      this.prisma,
      userId,
      data.projectId,
      data.sectionId,
    );
    const labelIds =
      data.labelIds === undefined
        ? undefined
        : await validatePrismaLabelIds(this.prisma, userId, data.labelIds);
    const syncSeq = await this.nextSyncSeq(userId);
    const updated = await this.prisma.task.update({
      where: { id },
      data: buildTaskUpdateData(data, syncSeq, labelIds),
      include: TASK_WITH_LABELS_INCLUDE,
    });
    recordTaskMutationMetric(data.isDeleted === true ? "deleted" : "updated");
    const after = mapPrismaTask(updated);
    await recordPrismaMutation(this.prisma, {
      userId,
      syncSeq,
      entityType: "task",
      entityId: id,
      action: inferTaskUpdateAction(
        before,
        after,
        data,
        this.auditContext?.actionHint,
      ),
      audit: this.auditContext,
      before,
      after,
    });
    return after;
  }

  async deleteTask(id: string, userId: string): Promise<boolean> {
    const existing = await this.prisma.task.findFirst({
      where: { id, userId },
      include: TASK_WITH_LABELS_INCLUDE,
    });
    if (existing === null) {
      return false;
    }
    const before = mapPrismaTask(existing);
    const syncSeq = await this.nextSyncSeq(userId);
    const updated = await this.prisma.task.update({
      where: { id },
      data: { isDeleted: true, syncSeq },
      include: TASK_WITH_LABELS_INCLUDE,
    });
    recordTaskMutationMetric("deleted");
    await recordPrismaMutation(this.prisma, {
      userId,
      syncSeq,
      entityType: "task",
      entityId: id,
      action: "delete",
      audit: this.auditContext,
      before,
      after: mapPrismaTask(updated),
    });
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

  createProject(data: V1.CreateProjectInput): Promise<Project> {
    return createPrismaProject(this.secondaryCtx(), data);
  }
  updateProject(
    id: string,
    userId: string,
    data: V1.UpdateProjectInput,
  ): Promise<Project | null> {
    return updatePrismaProject(this.secondaryCtx(), id, userId, data);
  }
  deleteProject(id: string, userId: string): Promise<boolean> {
    return deletePrismaProject(this.secondaryCtx(), id, userId);
  }
  getProject(id: string, userId?: string): Promise<Project | null> {
    return getPrismaProject(this.secondaryCtx(), id, userId);
  }
  listProjects(filter: V1.ListProjectsFilter): Promise<Project[]> {
    return listPrismaProjects(this.secondaryCtx(), filter);
  }

  createSection(data: V1.CreateSectionInput): Promise<Section> {
    return createPrismaSection(this.secondaryCtx(), data);
  }
  updateSection(
    id: string,
    userId: string,
    data: V1.UpdateSectionInput,
  ): Promise<Section | null> {
    return updatePrismaSection(this.secondaryCtx(), id, userId, data);
  }
  deleteSection(id: string, userId: string): Promise<boolean> {
    return deletePrismaSection(this.secondaryCtx(), id, userId);
  }
  getSection(id: string, userId?: string): Promise<Section | null> {
    return getPrismaSection(this.secondaryCtx(), id, userId);
  }
  listSections(filter: V1.ListSectionsFilter): Promise<Section[]> {
    return listPrismaSections(this.secondaryCtx(), filter);
  }

  createLabel(data: V1.CreateLabelInput): Promise<Label> {
    return createPrismaLabel(this.secondaryCtx(), data);
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
  getLabel(id: string, userId?: string): Promise<Label | null> {
    return getPrismaLabel(this.secondaryCtx(), id, userId);
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
  getReminder(id: string, userId?: string): Promise<Reminder | null> {
    return getPrismaReminder(this.secondaryCtx(), id, userId);
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
  getFilter(id: string, userId?: string): Promise<Filter | null> {
    return getPrismaFilter(this.secondaryCtx(), id, userId);
  }
  listFilters(filter: V1.ListFiltersFilter): Promise<Filter[]> {
    return listPrismaFilters(this.secondaryCtx(), filter);
  }
}
