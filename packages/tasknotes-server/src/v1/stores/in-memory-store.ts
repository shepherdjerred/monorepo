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
  MutationAction,
  MutationEntityType,
  MutationPage,
} from "../auth-types.ts";
import type { StoredEntry, StoredUser } from "./in-memory-helpers.ts";
import {
  createInMemoryFilter,
  createInMemoryReminder,
  getInMemoryFilter,
  getInMemoryReminder,
  listInMemoryFilters,
  listInMemoryReminders,
  updateInMemoryFilter,
  updateInMemoryReminder,
} from "./in-memory-reminders-filters.ts";
import {
  createInMemoryLabel,
  createInMemoryProject,
  createInMemorySection,
  deleteInMemoryLabel,
  getInMemoryLabel,
  getInMemoryProject,
  getInMemorySection,
  type InMemorySecondaryCtx,
  listInMemoryLabels,
  listInMemoryProjects,
  listInMemorySections,
  updateInMemoryLabel,
  updateInMemoryProject,
  updateInMemorySection,
} from "./in-memory-secondary.ts";
import {
  completeInMemoryTask,
  createEmptyBackingState,
  createInMemoryTask,
  getInMemoryTask,
  type InMemoryBackingState,
  listInMemoryTasks,
  runWithInMemorySavepoint,
  updateInMemoryTask,
} from "./in-memory-tasks.ts";
import {
  authenticateInMemoryApiToken,
  createInMemoryApiToken,
  listInMemoryApiTokens,
  listInMemoryMutations,
  recordInMemoryMutation,
  revokeInMemoryApiToken,
} from "./in-memory-tokens-audit.ts";
import { recordTaskMutationMetric } from "../mappers.ts";
import type {
  CreateFilterInput,
  CreateLabelInput,
  CreateProjectInput,
  CreateReminderInput,
  CreateSectionInput,
  CreateTaskInput,
  FacetStore,
  ListFiltersFilter,
  ListLabelsFilter,
  ListProjectsFilter,
  ListRemindersFilter,
  ListSectionsFilter,
  ListTasksFilter,
  ProcessedCommandRecord,
  UpdateFilterInput,
  UpdateLabelInput,
  UpdateProjectInput,
  UpdateReminderInput,
  UpdateSectionInput,
  UpdateTaskInput,
} from "../types.ts";

export class InMemoryFacetStore implements FacetStore {
  private readonly state: InMemoryBackingState;
  private readonly auditContext: AuditContext | undefined;

  constructor(state?: InMemoryBackingState, auditContext?: AuditContext) {
    this.state = state ?? createEmptyBackingState();
    this.auditContext = auditContext;
  }

  private secondaryCtx(): InMemorySecondaryCtx {
    return {
      clock: this.state.clock,
      audit: this.auditContext,
      mutationEvents: this.state.mutationEvents,
      tasks: this.state.tasks,
      projects: this.state.projects,
      sections: this.state.sections,
      labels: this.state.labels,
      reminders: this.state.reminders,
      filters: this.state.filters,
      nextSyncSeq: (uid) => this.nextSyncSeq(uid),
      onCommit: (fn) => {
        this.state.metrics.enqueue(fn);
      },
      mutateWithAudit: (params) => this.mutateWithAudit(params),
    };
  }

  private ensureUserRecord(userId: string): StoredUser {
    let user = this.state.users.get(userId);
    if (user === undefined) {
      user = {
        id: userId,
        email: `${userId}@tasknotes.local`,
        name: "Default User",
        syncSequence: 0n,
      };
      this.state.users.set(userId, user);
    }
    return user;
  }

  private nextSyncSeq(userId: string): bigint {
    const user = this.ensureUserRecord(userId);
    user.syncSequence += 1n;
    return user.syncSequence;
  }

  private mutateWithAudit<T extends object>(params: {
    map: Map<string, StoredEntry<T>>;
    id: string;
    userId: string;
    entityType: MutationEntityType;
    resolveAction: (before: T, after: T) => MutationAction;
    mutate: (val: T, nowIso: string) => void;
  }): T | null {
    const entry = params.map.get(params.id);
    if (entry?.userId !== params.userId) {
      return null;
    }
    const before = structuredClone(entry.value);
    const now = this.state.clock.now();
    params.mutate(entry.value, now.toISOString());
    const syncSeq = this.nextSyncSeq(params.userId);
    entry.updatedAt = now;
    entry.syncSeq = syncSeq;
    const after = structuredClone(entry.value);
    recordInMemoryMutation(this.state.mutationEvents, this.state.clock, {
      userId: params.userId,
      syncSeq,
      entityType: params.entityType,
      entityId: params.id,
      action: params.resolveAction(before, after),
      audit: this.auditContext,
      before,
      after,
      onCommit: (fn) => {
        this.state.metrics.enqueue(fn);
      },
    });
    return after;
  }

  private deleteTimestamped<
    T extends { is_deleted: boolean; updated_at: string },
  >(
    map: Map<string, StoredEntry<T>>,
    id: string,
    userId: string,
    entityType: MutationEntityType,
  ): boolean {
    const updated = this.mutateWithAudit({
      map,
      id,
      userId,
      entityType,
      resolveAction: () => "delete",
      mutate: (val, nowIso) => {
        val.is_deleted = true;
        val.updated_at = nowIso;
      },
    });
    return updated !== null;
  }

  getNow(): Date {
    return this.state.clock.now();
  }
  withAuditContext(ctx: AuditContext | undefined): FacetStore {
    return new InMemoryFacetStore(this.state, ctx);
  }
  getAuditContext(): AuditContext | undefined {
    return this.auditContext;
  }
  transaction<T>(fn: (tx: FacetStore) => Promise<T>): Promise<T> {
    return runWithInMemorySavepoint(this.state, () => fn(this));
  }
  runInSavepoint<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return runWithInMemorySavepoint(this.state, fn);
  }

  async getOrCreateUser(
    userId: string,
  ): Promise<{ id: string; email: string; name: string }> {
    const user = this.ensureUserRecord(userId);
    const hasInbox = [...this.state.projects.values()].some(
      (e) => e.userId === userId && e.value.is_inbox && !e.value.is_deleted,
    );
    if (!hasInbox) {
      await this.withAuditContext(undefined).createProject({
        userId,
        name: "Inbox",
        isInbox: true,
      });
    }
    return { id: user.id, email: user.email, name: user.name };
  }

  getSyncSequence(userId: string): Promise<bigint> {
    return Promise.resolve(this.state.users.get(userId)?.syncSequence ?? 0n);
  }

  getProcessedCommand(uuid: string): Promise<ProcessedCommandRecord | null> {
    const found = this.state.processedCommands.get(uuid);
    return Promise.resolve(
      found === undefined
        ? null
        : { status: found.status, resultId: found.resultId },
    );
  }

  recordProcessedCommand(
    uuid: string,
    userId: string,
    status: string,
    resultId: string | null = null,
  ): Promise<void> {
    this.state.processedCommands.set(uuid, {
      uuid,
      userId,
      status,
      resultId,
      tokenId: this.auditContext?.tokenId ?? null,
      actorName: this.auditContext?.actorName ?? null,
      actorKind: this.auditContext?.actorKind ?? null,
    });
    return Promise.resolve();
  }

  createApiToken(data: CreateApiTokenInput): Promise<ApiTokenSummary> {
    this.ensureUserRecord(data.userId);
    return Promise.resolve(
      createInMemoryApiToken(this.state.apiTokens, this.state.clock, data),
    );
  }
  listApiTokens(
    userId: string,
    options?: { includeRevoked?: boolean | undefined },
  ): Promise<ApiTokenSummary[]> {
    return Promise.resolve(
      listInMemoryApiTokens(this.state.apiTokens, userId, options),
    );
  }
  revokeApiToken(id: string, userId: string): Promise<ApiTokenSummary | null> {
    return Promise.resolve(
      revokeInMemoryApiToken(
        this.state.apiTokens,
        this.state.clock,
        id,
        userId,
      ),
    );
  }
  authenticateApiToken(
    tokenHash: string,
  ): Promise<AuthenticatedApiToken | null> {
    return Promise.resolve(
      authenticateInMemoryApiToken(
        this.state.apiTokens,
        this.state.clock,
        tokenHash,
      ),
    );
  }
  listMutations(filter: ListMutationsFilter): Promise<MutationPage> {
    return Promise.resolve(
      listInMemoryMutations(this.state.mutationEvents, filter),
    );
  }

  countActiveTasks(): Promise<number> {
    let count = 0;
    for (const entry of this.state.tasks.values()) {
      if (!entry.value.is_deleted) {
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  createTask(data: CreateTaskInput): Promise<Task> {
    return Promise.resolve(createInMemoryTask(this.secondaryCtx(), data));
  }
  updateTask(
    id: string,
    userId: string,
    data: UpdateTaskInput,
  ): Promise<Task | null> {
    return Promise.resolve(
      updateInMemoryTask(this.secondaryCtx(), this.state.attachments, id, {
        userId,
        data,
      }),
    );
  }
  completeTask(
    id: string,
    userId: string,
    completedAt?: Date,
  ): Promise<Task | null> {
    return Promise.resolve(
      completeInMemoryTask(this.secondaryCtx(), this.state.attachments, id, {
        userId,
        completedAt: completedAt ?? this.getNow(),
      }),
    );
  }
  deleteTask(id: string, userId: string): Promise<boolean> {
    const deleted = this.deleteTimestamped(
      this.state.tasks,
      id,
      userId,
      "task",
    );
    if (deleted) {
      this.state.metrics.enqueue(() => {
        recordTaskMutationMetric("deleted");
      });
    }
    return Promise.resolve(deleted);
  }
  getAttachment(
    taskId: string,
    commentId: string,
    userId: string,
  ): Promise<Uint8Array<ArrayBuffer> | null> {
    const task = this.state.tasks.get(taskId);
    return Promise.resolve(
      task?.userId === userId && !task.value.is_deleted
        ? (this.state.attachments.get(taskId)?.get(commentId) ?? null)
        : null,
    );
  }
  getTask(id: string, userId?: string): Promise<Task | null> {
    return Promise.resolve(getInMemoryTask(this.secondaryCtx(), id, userId));
  }
  listTasks(filter: ListTasksFilter): Promise<Task[]> {
    return Promise.resolve(listInMemoryTasks(this.secondaryCtx(), filter));
  }

  createProject(data: CreateProjectInput): Promise<Project> {
    return Promise.resolve(createInMemoryProject(this.secondaryCtx(), data));
  }
  updateProject(
    id: string,
    userId: string,
    data: UpdateProjectInput,
  ): Promise<Project | null> {
    return Promise.resolve(
      updateInMemoryProject(this.secondaryCtx(), id, userId, data),
    );
  }
  deleteProject(id: string, userId: string): Promise<boolean> {
    return Promise.resolve(
      this.deleteTimestamped(this.state.projects, id, userId, "project"),
    );
  }
  getProject(id: string, userId?: string): Promise<Project | null> {
    return Promise.resolve(getInMemoryProject(this.secondaryCtx(), id, userId));
  }
  listProjects(filter: ListProjectsFilter): Promise<Project[]> {
    return Promise.resolve(listInMemoryProjects(this.secondaryCtx(), filter));
  }

  createSection(data: CreateSectionInput): Promise<Section> {
    return Promise.resolve(createInMemorySection(this.secondaryCtx(), data));
  }
  updateSection(
    id: string,
    userId: string,
    data: UpdateSectionInput,
  ): Promise<Section | null> {
    return Promise.resolve(
      updateInMemorySection(this.secondaryCtx(), id, userId, data),
    );
  }
  deleteSection(id: string, userId: string): Promise<boolean> {
    return Promise.resolve(
      this.deleteTimestamped(this.state.sections, id, userId, "section"),
    );
  }
  getSection(id: string, userId?: string): Promise<Section | null> {
    return Promise.resolve(getInMemorySection(this.secondaryCtx(), id, userId));
  }
  listSections(filter: ListSectionsFilter): Promise<Section[]> {
    return Promise.resolve(listInMemorySections(this.secondaryCtx(), filter));
  }

  createLabel(data: CreateLabelInput): Promise<Label> {
    return Promise.resolve(createInMemoryLabel(this.secondaryCtx(), data));
  }
  updateLabel(
    id: string,
    userId: string,
    data: UpdateLabelInput,
  ): Promise<Label | null> {
    return Promise.resolve(
      updateInMemoryLabel(this.secondaryCtx(), id, userId, data),
    );
  }
  deleteLabel(id: string, userId: string): Promise<boolean> {
    return Promise.resolve(
      deleteInMemoryLabel(this.secondaryCtx(), id, userId),
    );
  }
  getLabel(id: string, userId?: string): Promise<Label | null> {
    return Promise.resolve(getInMemoryLabel(this.secondaryCtx(), id, userId));
  }
  listLabels(filter: ListLabelsFilter): Promise<Label[]> {
    return Promise.resolve(listInMemoryLabels(this.secondaryCtx(), filter));
  }

  createReminder(data: CreateReminderInput): Promise<Reminder> {
    return Promise.resolve(createInMemoryReminder(this.secondaryCtx(), data));
  }
  updateReminder(
    id: string,
    userId: string,
    data: UpdateReminderInput,
  ): Promise<Reminder | null> {
    return Promise.resolve(
      updateInMemoryReminder(this.secondaryCtx(), id, userId, data),
    );
  }
  deleteReminder(id: string, userId: string): Promise<boolean> {
    return Promise.resolve(
      this.deleteTimestamped(this.state.reminders, id, userId, "reminder"),
    );
  }
  getReminder(id: string, userId?: string): Promise<Reminder | null> {
    return Promise.resolve(
      getInMemoryReminder(this.secondaryCtx(), id, userId),
    );
  }
  listReminders(filter: ListRemindersFilter): Promise<Reminder[]> {
    return Promise.resolve(listInMemoryReminders(this.secondaryCtx(), filter));
  }

  createFilter(data: CreateFilterInput): Promise<Filter> {
    return Promise.resolve(createInMemoryFilter(this.secondaryCtx(), data));
  }
  updateFilter(
    id: string,
    userId: string,
    data: UpdateFilterInput,
  ): Promise<Filter | null> {
    return Promise.resolve(
      updateInMemoryFilter(this.secondaryCtx(), id, userId, data),
    );
  }
  deleteFilter(id: string, userId: string): Promise<boolean> {
    const updated = this.mutateWithAudit({
      map: this.state.filters,
      id,
      userId,
      entityType: "filter",
      resolveAction: () => "delete",
      mutate: (flt) => {
        flt.is_deleted = true;
      },
    });
    return Promise.resolve(updated !== null);
  }
  getFilter(id: string, userId?: string): Promise<Filter | null> {
    return Promise.resolve(getInMemoryFilter(this.secondaryCtx(), id, userId));
  }
  listFilters(filter: ListFiltersFilter): Promise<Filter[]> {
    return Promise.resolve(listInMemoryFilters(this.secondaryCtx(), filter));
  }
}
