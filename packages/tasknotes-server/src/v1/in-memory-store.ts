import type {
  Filter,
  Label,
  Project,
  Reminder,
  Section,
  Task,
} from "../protocol/generated.ts";
import {
  applyProjectUpdate,
  newMemoryTask,
  applyTaskUpdateDates,
  applyTaskUpdateFields,
  assertOwnedEntry,
  MonotonicClock,
  queryStoredEntries,
  restoreMap,
  type StoredEntry,
  type StoredUser,
} from "./in-memory-helpers.ts";
import {
  createInMemoryFilter,
  createInMemoryLabel,
  createInMemoryReminder,
  createInMemorySection,
  deleteInMemoryLabel,
  type InMemorySecondaryCtx,
  listInMemoryFilters,
  listInMemoryLabels,
  listInMemoryReminders,
  listInMemorySections,
  updateInMemoryFilter,
  updateInMemoryLabel,
  updateInMemoryReminder,
  updateInMemorySection,
} from "./in-memory-secondary.ts";
import { recordTaskMutationMetric } from "./mappers.ts";
import {
  type CreateFilterInput,
  type CreateLabelInput,
  type CreateProjectInput,
  type CreateReminderInput,
  type CreateSectionInput,
  type CreateTaskInput,
  EntityNotFoundError,
  type FacetStore,
  type ListFiltersFilter,
  type ListLabelsFilter,
  type ListProjectsFilter,
  type ListRemindersFilter,
  type ListSectionsFilter,
  type ListTasksFilter,
  type ProcessedCommandRecord,
  type UpdateFilterInput,
  type UpdateLabelInput,
  type UpdateProjectInput,
  type UpdateReminderInput,
  type UpdateSectionInput,
  type UpdateTaskInput,
} from "./types.ts";

import { applyCommentMutation } from "./comments.ts";

export class InMemoryFacetStore implements FacetStore {
  private readonly attachments = new Map<
    string,
    Map<string, Uint8Array<ArrayBuffer>>
  >();
  private readonly clock = new MonotonicClock();
  private readonly users = new Map<string, StoredUser>();
  private readonly tasks = new Map<string, StoredEntry<Task>>();
  private readonly projects = new Map<string, StoredEntry<Project>>();
  private readonly sections = new Map<string, StoredEntry<Section>>();
  private readonly labels = new Map<string, StoredEntry<Label>>();
  private readonly reminders = new Map<string, StoredEntry<Reminder>>();
  private readonly filters = new Map<string, StoredEntry<Filter>>();
  private readonly processedCommands = new Map<
    string,
    { uuid: string; userId: string; status: string; resultId: string | null }
  >();

  private secondaryCtx(): InMemorySecondaryCtx {
    return {
      clock: this.clock,
      tasks: this.tasks,
      projects: this.projects,
      sections: this.sections,
      labels: this.labels,
      reminders: this.reminders,
      filters: this.filters,
      nextSyncSeq: (uid) => this.nextSyncSeq(uid),
      mutateEntry: (map, id, uid, fn) => this.mutateEntry(map, id, uid, fn),
    };
  }

  private ensureUserRecord(userId: string): StoredUser {
    let user = this.users.get(userId);
    if (user === undefined) {
      user = {
        id: userId,
        email: `${userId}@tasknotes.local`,
        name: "Default User",
        syncSequence: 0n,
      };
      this.users.set(userId, user);
    }
    return user;
  }

  private nextSyncSeq(userId: string): bigint {
    const user = this.ensureUserRecord(userId);
    user.syncSequence += 1n;
    return user.syncSequence;
  }

  private validateLabelIds(userId: string, labelIds: string[]): string[] {
    const deduped = [...new Set(labelIds)];
    for (const labelId of deduped) {
      const label = this.labels.get(labelId);
      if (label?.userId !== userId || label.value.is_deleted) {
        throw new EntityNotFoundError("Label", labelId);
      }
    }
    return deduped;
  }

  private validateTaskRefs(
    userId: string,
    projectId: string | undefined,
    sectionId: string | null | undefined,
  ): void {
    if (projectId !== undefined) {
      assertOwnedEntry(this.projects, projectId, userId, "Project");
    }
    if (sectionId !== undefined && sectionId !== null && sectionId !== "") {
      assertOwnedEntry(this.sections, sectionId, userId, "Section");
    }
  }

  private mutateEntry<T>(
    map: Map<string, StoredEntry<T>>,
    id: string,
    userId: string,
    mutate: (val: T, nowIso: string) => void,
  ): T | null {
    const entry = map.get(id);
    if (entry?.userId !== userId) {
      return null;
    }
    const now = this.clock.now();
    mutate(entry.value, now.toISOString());
    entry.updatedAt = now;
    entry.syncSeq = this.nextSyncSeq(userId);
    return structuredClone(entry.value);
  }

  private deleteTimestamped<
    T extends { is_deleted: boolean; updated_at: string },
  >(map: Map<string, StoredEntry<T>>, id: string, userId: string): boolean {
    const updated = this.mutateEntry(map, id, userId, (val, nowIso) => {
      val.is_deleted = true;
      val.updated_at = nowIso;
    });
    return updated !== null;
  }

  getNow(): Date {
    return this.clock.now();
  }

  transaction<T>(fn: (tx: FacetStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async runInSavepoint<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    const clockSnap = this.clock.snapshot();
    const usersSnap = structuredClone(this.users);
    const attachmentSnap = structuredClone(this.attachments);
    const tasksSnap = structuredClone(this.tasks);
    const projectsSnap = structuredClone(this.projects);
    const sectionsSnap = structuredClone(this.sections);
    const labelsSnap = structuredClone(this.labels);
    const remindersSnap = structuredClone(this.reminders);
    const filtersSnap = structuredClone(this.filters);
    const commandsSnap = structuredClone(this.processedCommands);
    try {
      return await fn();
    } catch (error: unknown) {
      this.clock.restore(clockSnap);
      restoreMap(this.users, usersSnap);
      restoreMap(this.tasks, tasksSnap);
      restoreMap(this.attachments, attachmentSnap);
      restoreMap(this.projects, projectsSnap);
      restoreMap(this.sections, sectionsSnap);
      restoreMap(this.labels, labelsSnap);
      restoreMap(this.reminders, remindersSnap);
      restoreMap(this.filters, filtersSnap);
      restoreMap(this.processedCommands, commandsSnap);
      throw error;
    }
  }

  async getOrCreateUser(
    userId: string,
  ): Promise<{ id: string; email: string; name: string }> {
    const user = this.ensureUserRecord(userId);
    const hasInbox = [...this.projects.values()].some(
      (e) => e.userId === userId && e.value.is_inbox && !e.value.is_deleted,
    );
    if (!hasInbox) {
      await this.createProject({ userId, name: "Inbox", isInbox: true });
    }
    return { id: user.id, email: user.email, name: user.name };
  }

  getSyncSequence(userId: string): Promise<bigint> {
    return Promise.resolve(this.users.get(userId)?.syncSequence ?? 0n);
  }

  getProcessedCommand(uuid: string): Promise<ProcessedCommandRecord | null> {
    const found = this.processedCommands.get(uuid);
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
    this.processedCommands.set(uuid, { uuid, userId, status, resultId });
    return Promise.resolve();
  }

  countActiveTasks(): Promise<number> {
    let count = 0;
    for (const entry of this.tasks.values()) {
      if (!entry.value.is_deleted) {
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  createTask(data: CreateTaskInput): Promise<Task> {
    this.validateTaskRefs(data.userId, data.projectId, data.sectionId);
    const labelIds =
      data.labelIds === undefined
        ? []
        : this.validateLabelIds(data.userId, data.labelIds);
    const id = data.id ?? crypto.randomUUID();
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const task = newMemoryTask(data, id, nowIso, labelIds);
    this.tasks.set(id, {
      value: task,
      userId: data.userId,
      updatedAt: now,
      syncSeq: this.nextSyncSeq(data.userId),
    });
    recordTaskMutationMetric("created");
    return Promise.resolve(structuredClone(task));
  }

  updateTask(
    id: string,
    userId: string,
    data: UpdateTaskInput,
  ): Promise<Task | null> {
    const entry = this.tasks.get(id);
    if (entry?.userId !== userId) {
      return Promise.resolve(null);
    }
    this.validateTaskRefs(userId, data.projectId, data.sectionId);
    const validated: UpdateTaskInput =
      data.labelIds === undefined
        ? data
        : { ...data, labelIds: this.validateLabelIds(userId, data.labelIds) };
    const updated = this.mutateEntry(this.tasks, id, userId, (task, nowIso) => {
      applyCommentMutation(task, validated, this.attachments);
      applyTaskUpdateFields(task, validated);
      applyTaskUpdateDates(task, validated);
      task.updated_at = nowIso;
    });
    if (updated !== null) {
      recordTaskMutationMetric(
        validated.isDeleted === true ? "deleted" : "updated",
      );
    }
    return Promise.resolve(updated);
  }

  deleteTask(id: string, userId: string): Promise<boolean> {
    const deleted = this.deleteTimestamped(this.tasks, id, userId);
    if (deleted) {
      recordTaskMutationMetric("deleted");
    }
    return Promise.resolve(deleted);
  }

  getAttachment(
    taskId: string,
    commentId: string,
    userId: string,
  ): Promise<Uint8Array<ArrayBuffer> | null> {
    const task = this.tasks.get(taskId);
    return Promise.resolve(
      task?.userId === userId && !task.value.is_deleted
        ? (this.attachments.get(taskId)?.get(commentId) ?? null)
        : null,
    );
  }

  getTask(id: string, userId?: string): Promise<Task | null> {
    const entry = this.tasks.get(id);
    return entry === undefined ||
      (userId !== undefined && userId !== "" && entry.userId !== userId)
      ? Promise.resolve(null)
      : Promise.resolve(structuredClone(entry.value));
  }

  listTasks(filter: ListTasksFilter): Promise<Task[]> {
    const pid =
      filter.projectId !== undefined && filter.projectId !== ""
        ? filter.projectId
        : undefined;
    return Promise.resolve(
      queryStoredEntries(this.tasks, filter, {
        predicate: pid === undefined ? undefined : (t) => t.project_id === pid,
        compare: (a, b) => a.child_order - b.child_order,
      }),
    );
  }

  createProject(data: CreateProjectInput): Promise<Project> {
    const id = data.id ?? crypto.randomUUID();
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const project: Project = {
      id,
      user_id: data.userId,
      name: data.name,
      color: data.color ?? "charcoal",
      child_order: data.childOrder ?? 0,
      is_inbox: data.isInbox ?? false,
      is_favorite: data.isFavorite ?? false,
      is_archived: data.isArchived ?? false,
      is_deleted: false,
      created_at: nowIso,
      updated_at: nowIso,
    };
    if (
      data.parentId !== undefined &&
      data.parentId !== null &&
      data.parentId !== ""
    ) {
      project.parent_id = data.parentId;
    }
    this.projects.set(id, {
      value: project,
      userId: data.userId,
      updatedAt: now,
      syncSeq: this.nextSyncSeq(data.userId),
    });
    return Promise.resolve(structuredClone(project));
  }

  updateProject(
    id: string,
    userId: string,
    data: UpdateProjectInput,
  ): Promise<Project | null> {
    return Promise.resolve(
      this.mutateEntry(this.projects, id, userId, (proj, nowIso) => {
        applyProjectUpdate(proj, data);
        proj.updated_at = nowIso;
      }),
    );
  }

  deleteProject(id: string, userId: string): Promise<boolean> {
    return Promise.resolve(this.deleteTimestamped(this.projects, id, userId));
  }

  getProject(id: string, userId?: string): Promise<Project | null> {
    const entry = this.projects.get(id);
    return entry === undefined ||
      (userId !== undefined && userId !== "" && entry.userId !== userId)
      ? Promise.resolve(null)
      : Promise.resolve(structuredClone(entry.value));
  }

  listProjects(filter: ListProjectsFilter): Promise<Project[]> {
    return Promise.resolve(
      queryStoredEntries(this.projects, filter, {
        compare: (a, b) => a.child_order - b.child_order,
      }),
    );
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
    return Promise.resolve(this.deleteTimestamped(this.sections, id, userId));
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
    return Promise.resolve(this.deleteTimestamped(this.reminders, id, userId));
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
    const updated = this.mutateEntry(this.filters, id, userId, (flt) => {
      flt.is_deleted = true;
    });
    return Promise.resolve(updated !== null);
  }

  listFilters(filter: ListFiltersFilter): Promise<Filter[]> {
    return Promise.resolve(listInMemoryFilters(this.secondaryCtx(), filter));
  }
}
