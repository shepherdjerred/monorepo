import type { Prisma, PrismaClient } from "#generated/prisma/client.ts";
import type {
  Filter,
  Label,
  Project,
  Reminder,
  Section,
  Task,
} from "../../protocol/generated.ts";
import type {
  ApiTokenSummary,
  AuditContext,
  AuthenticatedApiToken,
  CreateApiTokenInput,
  ListMutationsFilter,
  MutationPage,
} from "../auth-types.ts";
import { sanitizeSavepointName } from "./prisma-helpers.ts";
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
  completePrismaTask,
  createPrismaTask,
  deletePrismaTask,
  getPrismaTask,
  listPrismaTasks,
  updatePrismaTask,
} from "./prisma-tasks.ts";
import {
  authenticatePrismaApiToken,
  createPrismaApiToken,
  listPrismaApiTokens,
  listPrismaMutations,
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

  private async inTx<T>(fn: (tx: PrismaFacetStore) => Promise<T>): Promise<T> {
    return !this.inTransaction && "$transaction" in this.prisma
      ? await this.prisma.$transaction(
          async (txClient: Prisma.TransactionClient) =>
            await fn(new PrismaFacetStore(txClient, true, this.auditContext)),
        )
      : await fn(this);
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
    return await this.inTx(fn);
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
    return await this.inTx(async (tx) => {
      const user = await tx.prisma.user.upsert({
        where: { id: userId },
        create: {
          id: userId,
          email: `${userId}@tasknotes.local`,
          name: "Default User",
        },
        update: {},
      });
      const existingInbox = await tx.prisma.project.findFirst({
        where: { userId, isInbox: true, isDeleted: false },
        select: { id: true },
      });
      if (existingInbox === null) {
        await tx.withAuditContext(undefined).createProject({
          userId,
          name: "Inbox",
          isInbox: true,
        });
      }
      return { id: user.id, email: user.email, name: user.name };
    });
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
    return this.inTx((tx) => createPrismaApiToken(tx.prisma, data));
  }
  listApiTokens(
    userId: string,
    options?: { includeRevoked?: boolean | undefined },
  ): Promise<ApiTokenSummary[]> {
    return listPrismaApiTokens(this.prisma, userId, options);
  }
  revokeApiToken(id: string, userId: string): Promise<ApiTokenSummary | null> {
    return this.inTx((tx) =>
      revokePrismaApiToken(tx.prisma, id, userId, tx.getNow()),
    );
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

  createTask(data: V1.CreateTaskInput): Promise<Task> {
    return this.inTx((tx) => createPrismaTask(tx.secondaryCtx(), data));
  }
  updateTask(
    id: string,
    userId: string,
    data: V1.UpdateTaskInput,
  ): Promise<Task | null> {
    return this.inTx((tx) =>
      updatePrismaTask(tx.secondaryCtx(), id, userId, data),
    );
  }
  completeTask(
    id: string,
    userId: string,
    completedAt?: Date,
  ): Promise<Task | null> {
    const when = completedAt ?? this.getNow();
    return this.inTx((tx) =>
      completePrismaTask(tx.secondaryCtx(), id, userId, when),
    );
  }
  deleteTask(id: string, userId: string): Promise<boolean> {
    return this.inTx((tx) => deletePrismaTask(tx.secondaryCtx(), id, userId));
  }
  getTask(id: string, userId?: string): Promise<Task | null> {
    return getPrismaTask(this.prisma, id, userId);
  }
  listTasks(filter: V1.ListTasksFilter): Promise<Task[]> {
    return listPrismaTasks(this.prisma, filter);
  }

  createProject(data: V1.CreateProjectInput): Promise<Project> {
    return this.inTx((tx) => createPrismaProject(tx.secondaryCtx(), data));
  }
  updateProject(
    id: string,
    userId: string,
    data: V1.UpdateProjectInput,
  ): Promise<Project | null> {
    return this.inTx((tx) =>
      updatePrismaProject(tx.secondaryCtx(), id, userId, data),
    );
  }
  deleteProject(id: string, userId: string): Promise<boolean> {
    return this.inTx((tx) =>
      deletePrismaProject(tx.secondaryCtx(), id, userId),
    );
  }
  getProject(id: string, userId?: string): Promise<Project | null> {
    return getPrismaProject(this.secondaryCtx(), id, userId);
  }
  listProjects(filter: V1.ListProjectsFilter): Promise<Project[]> {
    return listPrismaProjects(this.secondaryCtx(), filter);
  }

  createSection(data: V1.CreateSectionInput): Promise<Section> {
    return this.inTx((tx) => createPrismaSection(tx.secondaryCtx(), data));
  }
  updateSection(
    id: string,
    userId: string,
    data: V1.UpdateSectionInput,
  ): Promise<Section | null> {
    return this.inTx((tx) =>
      updatePrismaSection(tx.secondaryCtx(), id, userId, data),
    );
  }
  deleteSection(id: string, userId: string): Promise<boolean> {
    return this.inTx((tx) =>
      deletePrismaSection(tx.secondaryCtx(), id, userId),
    );
  }
  getSection(id: string, userId?: string): Promise<Section | null> {
    return getPrismaSection(this.secondaryCtx(), id, userId);
  }
  listSections(filter: V1.ListSectionsFilter): Promise<Section[]> {
    return listPrismaSections(this.secondaryCtx(), filter);
  }

  createLabel(data: V1.CreateLabelInput): Promise<Label> {
    return this.inTx((tx) => createPrismaLabel(tx.secondaryCtx(), data));
  }
  updateLabel(
    id: string,
    userId: string,
    data: V1.UpdateLabelInput,
  ): Promise<Label | null> {
    return this.inTx((tx) =>
      updatePrismaLabel(tx.secondaryCtx(), id, userId, data),
    );
  }
  deleteLabel(id: string, userId: string): Promise<boolean> {
    return this.inTx((tx) => deletePrismaLabel(tx.secondaryCtx(), id, userId));
  }
  getLabel(id: string, userId?: string): Promise<Label | null> {
    return getPrismaLabel(this.secondaryCtx(), id, userId);
  }
  listLabels(filter: V1.ListLabelsFilter): Promise<Label[]> {
    return listPrismaLabels(this.secondaryCtx(), filter);
  }

  createReminder(data: V1.CreateReminderInput): Promise<Reminder> {
    return this.inTx((tx) => createPrismaReminder(tx.secondaryCtx(), data));
  }
  updateReminder(
    id: string,
    userId: string,
    data: V1.UpdateReminderInput,
  ): Promise<Reminder | null> {
    return this.inTx((tx) =>
      updatePrismaReminder(tx.secondaryCtx(), id, userId, data),
    );
  }
  deleteReminder(id: string, userId: string): Promise<boolean> {
    return this.inTx((tx) =>
      deletePrismaReminder(tx.secondaryCtx(), id, userId),
    );
  }
  getReminder(id: string, userId?: string): Promise<Reminder | null> {
    return getPrismaReminder(this.secondaryCtx(), id, userId);
  }
  listReminders(filter: V1.ListRemindersFilter): Promise<Reminder[]> {
    return listPrismaReminders(this.secondaryCtx(), filter);
  }

  createFilter(data: V1.CreateFilterInput): Promise<Filter> {
    return this.inTx((tx) => createPrismaFilter(tx.secondaryCtx(), data));
  }
  updateFilter(
    id: string,
    userId: string,
    data: V1.UpdateFilterInput,
  ): Promise<Filter | null> {
    return this.inTx((tx) =>
      updatePrismaFilter(tx.secondaryCtx(), id, userId, data),
    );
  }
  deleteFilter(id: string, userId: string): Promise<boolean> {
    return this.inTx((tx) => deletePrismaFilter(tx.secondaryCtx(), id, userId));
  }
  getFilter(id: string, userId?: string): Promise<Filter | null> {
    return getPrismaFilter(this.secondaryCtx(), id, userId);
  }
  listFilters(filter: V1.ListFiltersFilter): Promise<Filter[]> {
    return listPrismaFilters(this.secondaryCtx(), filter);
  }
}
