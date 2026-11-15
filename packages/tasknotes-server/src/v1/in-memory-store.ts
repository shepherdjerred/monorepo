import {
  type Filter,
  type Label,
  type Project,
  type Reminder,
  type Section,
  type Task,
} from "../protocol/generated.ts";
import {
  applyTaskCreateOptions,
  applyTaskUpdateDates,
  applyTaskUpdateOptions,
  type InternalFilter,
  type InternalLabel,
  type InternalProject,
  type InternalReminder,
  type InternalSection,
  type InternalTask,
  MonotonicClock,
  parsePriority,
  setOrDelete,
} from "./in-memory-helpers.ts";
import type {
  CreateLabelInput,
  CreateProjectInput,
  CreateSectionInput,
  CreateTaskInput,
  FacetStore,
  ListFiltersFilter,
  ListLabelsFilter,
  ListProjectsFilter,
  ListRemindersFilter,
  ListSectionsFilter,
  ListTasksFilter,
  UpdateLabelInput,
  UpdateProjectInput,
  UpdateSectionInput,
  UpdateTaskInput,
} from "./types.ts";

export class InMemoryFacetStore implements FacetStore {
  private readonly clock = new MonotonicClock();
  private readonly users = new Map<
    string,
    { id: string; email: string; name: string }
  >();
  private readonly tasks = new Map<string, InternalTask>();
  private readonly projects = new Map<string, InternalProject>();
  private readonly sections = new Map<string, InternalSection>();
  private readonly labels = new Map<string, InternalLabel>();
  private readonly reminders = new Map<string, InternalReminder>();
  private readonly filters = new Map<string, InternalFilter>();
  private readonly processedCommands = new Map<
    string,
    { uuid: string; userId: string; status: string }
  >();

  getNow(): Date {
    return this.clock.now();
  }

  transaction<T>(fn: (tx: FacetStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  getOrCreateUser(
    userId: string,
  ): Promise<{ id: string; email: string; name: string }> {
    let user = this.users.get(userId);
    if (user === undefined) {
      user = {
        id: userId,
        email: `${userId}@tasknotes.local`,
        name: "Default User",
      };
      this.users.set(userId, user);
    }
    return Promise.resolve(user);
  }

  isCommandProcessed(uuid: string): Promise<boolean> {
    return Promise.resolve(this.processedCommands.has(uuid));
  }

  recordProcessedCommand(
    uuid: string,
    userId: string,
    status: string,
  ): Promise<void> {
    this.processedCommands.set(uuid, { uuid, userId, status });
    return Promise.resolve();
  }

  createTask(data: CreateTaskInput): Promise<Task> {
    const id = data.id ?? crypto.randomUUID();
    const now = this.clock.now();
    const nowIso = now.toISOString();

    const task: InternalTask = {
      id,
      user_id: data.userId,
      project_id: data.projectId,
      title: data.title,
      description: data.description ?? "",
      priority: parsePriority(data.priority),
      child_order: data.childOrder ?? 0,
      is_recurring: data.isRecurring ?? false,
      completed: data.completed ?? false,
      is_deleted: false,
      created_at: nowIso,
      updated_at: nowIso,
      _updatedAt: now,
    };

    applyTaskCreateOptions(task, data);
    this.tasks.set(id, task);
    return Promise.resolve(task);
  }

  updateTask(id: string, data: UpdateTaskInput): Promise<Task | null> {
    const task = this.tasks.get(id);
    if (task === undefined) return Promise.resolve(null);

    const now = this.clock.now();
    applyTaskUpdateOptions(task, data);
    applyTaskUpdateDates(task, data);

    task.updated_at = now.toISOString();
    task._updatedAt = now;
    return Promise.resolve(task);
  }

  deleteTask(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (task === undefined) return Promise.resolve(false);
    const now = this.clock.now();
    task.is_deleted = true;
    task.updated_at = now.toISOString();
    task._updatedAt = now;
    return Promise.resolve(true);
  }

  getTask(id: string, userId?: string): Promise<Task | null> {
    const task = this.tasks.get(id);
    if (task === undefined) return Promise.resolve(null);
    return Promise.resolve(
      userId !== undefined && userId !== "" && task.user_id !== userId
        ? null
        : task,
    );
  }

  listTasks(filter: ListTasksFilter): Promise<Task[]> {
    let result = [...this.tasks.values()].filter(
      (t) => t.user_id === filter.userId,
    );
    if (filter.projectId !== undefined && filter.projectId !== "") {
      result = result.filter((t) => t.project_id === filter.projectId);
    }
    if (filter.includeDeleted !== true) {
      result = result.filter((t) => !t.is_deleted);
    }
    if (filter.since !== undefined) {
      const sinceTime = filter.since.getTime();
      result = result.filter((t) => t._updatedAt.getTime() > sinceTime);
    }
    return Promise.resolve(
      result.sort((a, b) => a.child_order - b.child_order),
    );
  }

  createProject(data: CreateProjectInput): Promise<Project> {
    const id = data.id ?? crypto.randomUUID();
    const now = this.clock.now();
    const nowIso = now.toISOString();

    const project: InternalProject = {
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
      _updatedAt: now,
    };
    if (
      data.parentId !== undefined &&
      data.parentId !== null &&
      data.parentId !== ""
    ) {
      project.parent_id = data.parentId;
    }

    this.projects.set(id, project);
    return Promise.resolve(project);
  }

  updateProject(id: string, data: UpdateProjectInput): Promise<Project | null> {
    const project = this.projects.get(id);
    if (project === undefined) return Promise.resolve(null);

    const now = this.clock.now();
    if (data.name !== undefined) project.name = data.name;
    if (data.color !== undefined) project.color = data.color;
    setOrDelete(project, "parent_id", data.parentId);
    if (data.childOrder !== undefined) project.child_order = data.childOrder;
    if (data.isFavorite !== undefined) project.is_favorite = data.isFavorite;
    if (data.isArchived !== undefined) project.is_archived = data.isArchived;
    if (data.isDeleted !== undefined) project.is_deleted = data.isDeleted;

    project.updated_at = now.toISOString();
    project._updatedAt = now;
    return Promise.resolve(project);
  }

  deleteProject(id: string): Promise<boolean> {
    const project = this.projects.get(id);
    if (project === undefined) return Promise.resolve(false);
    const now = this.clock.now();
    project.is_deleted = true;
    project.updated_at = now.toISOString();
    project._updatedAt = now;
    return Promise.resolve(true);
  }

  getProject(id: string, userId?: string): Promise<Project | null> {
    const project = this.projects.get(id);
    if (project === undefined) return Promise.resolve(null);
    return Promise.resolve(
      userId !== undefined && userId !== "" && project.user_id !== userId
        ? null
        : project,
    );
  }

  listProjects(filter: ListProjectsFilter): Promise<Project[]> {
    let result = [...this.projects.values()].filter(
      (p) => p.user_id === filter.userId,
    );
    if (filter.includeDeleted !== true) {
      result = result.filter((p) => !p.is_deleted);
    }
    if (filter.since !== undefined) {
      const sinceTime = filter.since.getTime();
      result = result.filter((p) => p._updatedAt.getTime() > sinceTime);
    }
    return Promise.resolve(
      result.sort((a, b) => a.child_order - b.child_order),
    );
  }

  createSection(data: CreateSectionInput): Promise<Section> {
    const id = data.id ?? crypto.randomUUID();
    const now = this.clock.now();
    const nowIso = now.toISOString();

    const section: InternalSection = {
      id,
      project_id: data.projectId,
      user_id: data.userId,
      name: data.name,
      section_order: data.sectionOrder ?? 0,
      is_archived: false,
      is_deleted: false,
      created_at: nowIso,
      updated_at: nowIso,
      _updatedAt: now,
    };

    this.sections.set(id, section);
    return Promise.resolve(section);
  }

  updateSection(id: string, data: UpdateSectionInput): Promise<Section | null> {
    const section = this.sections.get(id);
    if (section === undefined) return Promise.resolve(null);

    const now = this.clock.now();
    if (data.name !== undefined) section.name = data.name;
    if (data.sectionOrder !== undefined)
      section.section_order = data.sectionOrder;
    if (data.isArchived !== undefined) section.is_archived = data.isArchived;
    if (data.isDeleted !== undefined) section.is_deleted = data.isDeleted;

    section.updated_at = now.toISOString();
    section._updatedAt = now;
    return Promise.resolve(section);
  }

  deleteSection(id: string): Promise<boolean> {
    const section = this.sections.get(id);
    if (section === undefined) return Promise.resolve(false);
    const now = this.clock.now();
    section.is_deleted = true;
    section.updated_at = now.toISOString();
    section._updatedAt = now;
    return Promise.resolve(true);
  }

  listSections(filter: ListSectionsFilter): Promise<Section[]> {
    let result = [...this.sections.values()].filter(
      (s) => s.user_id === filter.userId,
    );
    if (filter.projectId !== undefined && filter.projectId !== "") {
      result = result.filter((s) => s.project_id === filter.projectId);
    }
    if (filter.includeDeleted !== true) {
      result = result.filter((s) => !s.is_deleted);
    }
    if (filter.since !== undefined) {
      const sinceTime = filter.since.getTime();
      result = result.filter((s) => s._updatedAt.getTime() > sinceTime);
    }
    return Promise.resolve(
      result.sort((a, b) => a.section_order - b.section_order),
    );
  }

  createLabel(data: CreateLabelInput): Promise<Label> {
    const id = data.id ?? crypto.randomUUID();
    const now = this.clock.now();

    const label: InternalLabel = {
      id,
      user_id: data.userId,
      name: data.name,
      color: data.color ?? "grey",
      item_order: data.itemOrder ?? 0,
      is_favorite: data.isFavorite ?? false,
      is_deleted: false,
      _updatedAt: now,
    };

    this.labels.set(id, label);
    return Promise.resolve(label);
  }

  updateLabel(id: string, data: UpdateLabelInput): Promise<Label | null> {
    const label = this.labels.get(id);
    if (label === undefined) return Promise.resolve(null);

    const now = this.clock.now();
    if (data.name !== undefined) label.name = data.name;
    if (data.color !== undefined) label.color = data.color;
    if (data.itemOrder !== undefined) label.item_order = data.itemOrder;
    if (data.isFavorite !== undefined) label.is_favorite = data.isFavorite;
    if (data.isDeleted !== undefined) label.is_deleted = data.isDeleted;

    label._updatedAt = now;
    return Promise.resolve(label);
  }

  deleteLabel(id: string): Promise<boolean> {
    const label = this.labels.get(id);
    if (label === undefined) return Promise.resolve(false);
    const now = this.clock.now();
    label.is_deleted = true;
    label._updatedAt = now;
    return Promise.resolve(true);
  }

  listLabels(filter: ListLabelsFilter): Promise<Label[]> {
    let result = [...this.labels.values()].filter(
      (l) => l.user_id === filter.userId,
    );
    if (filter.includeDeleted !== true) {
      result = result.filter((l) => !l.is_deleted);
    }
    if (filter.since !== undefined) {
      const sinceTime = filter.since.getTime();
      result = result.filter((l) => l._updatedAt.getTime() > sinceTime);
    }
    return Promise.resolve(result.sort((a, b) => a.item_order - b.item_order));
  }

  listReminders(filter: ListRemindersFilter): Promise<Reminder[]> {
    let result = [...this.reminders.values()];
    if (filter.includeDeleted !== true) {
      result = result.filter((r) => !r.is_deleted);
    }
    if (filter.since !== undefined) {
      const sinceTime = filter.since.getTime();
      result = result.filter((r) => r._createdAt.getTime() > sinceTime);
    }
    return Promise.resolve(result);
  }

  listFilters(filter: ListFiltersFilter): Promise<Filter[]> {
    let result = [...this.filters.values()].filter(
      (f) => f.user_id === filter.userId,
    );
    if (filter.includeDeleted !== true) {
      result = result.filter((f) => !f.is_deleted);
    }
    if (filter.since !== undefined) {
      const sinceTime = filter.since.getTime();
      result = result.filter((f) => f._updatedAt.getTime() > sinceTime);
    }
    return Promise.resolve(result.sort((a, b) => a.item_order - b.item_order));
  }
}
