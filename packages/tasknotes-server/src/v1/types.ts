import {
  type Filter,
  type Label,
  Priority,
  type Project,
  type Reminder,
  type Section,
  type Task,
} from "../protocol/generated.ts";

export type TaskScheduleOptions = {
  childOrder?: number | undefined;
  dueDate?: Date | null | undefined;
  dueDatetime?: Date | null | undefined;
  dueTimezone?: string | null | undefined;
  dueString?: string | null | undefined;
  isRecurring?: boolean | undefined;
  recurrenceRule?: string | null | undefined;
  completed?: boolean | undefined;
  completedAt?: Date | null | undefined;
};

export type CreateTaskInput = TaskScheduleOptions & {
  id?: string | undefined;
  userId: string;
  projectId: string;
  sectionId?: string | null | undefined;
  parentId?: string | null | undefined;
  title: string;
  description?: string | undefined;
  priority?: Priority | string | undefined;
};

export type UpdateTaskInput = TaskScheduleOptions & {
  title?: string | undefined;
  description?: string | undefined;
  priority?: Priority | string | undefined;
  projectId?: string | undefined;
  sectionId?: string | null | undefined;
  parentId?: string | null | undefined;
  isDeleted?: boolean | undefined;
};

export type CreateProjectInput = {
  id?: string | undefined;
  userId: string;
  name: string;
  color?: string | undefined;
  parentId?: string | null | undefined;
  childOrder?: number | undefined;
  isInbox?: boolean | undefined;
  isFavorite?: boolean | undefined;
  isArchived?: boolean | undefined;
};

export type UpdateProjectInput = {
  name?: string | undefined;
  color?: string | undefined;
  parentId?: string | null | undefined;
  childOrder?: number | undefined;
  isFavorite?: boolean | undefined;
  isArchived?: boolean | undefined;
  isDeleted?: boolean | undefined;
};

export type CreateSectionInput = {
  id?: string | undefined;
  userId: string;
  projectId: string;
  name: string;
  sectionOrder?: number | undefined;
};

export type UpdateSectionInput = {
  name?: string | undefined;
  sectionOrder?: number | undefined;
  isArchived?: boolean | undefined;
  isDeleted?: boolean | undefined;
};

export type CreateLabelInput = {
  id?: string | undefined;
  userId: string;
  name: string;
  color?: string | undefined;
  itemOrder?: number | undefined;
  isFavorite?: boolean | undefined;
};

export type UpdateLabelInput = {
  name?: string | undefined;
  color?: string | undefined;
  itemOrder?: number | undefined;
  isFavorite?: boolean | undefined;
  isDeleted?: boolean | undefined;
};

export type ListTasksFilter = {
  userId: string;
  projectId?: string | undefined;
  since?: Date | undefined;
  includeDeleted?: boolean | undefined;
};

export type ListProjectsFilter = {
  userId: string;
  since?: Date | undefined;
  includeDeleted?: boolean | undefined;
};

export type ListSectionsFilter = {
  userId: string;
  projectId?: string | undefined;
  since?: Date | undefined;
  includeDeleted?: boolean | undefined;
};

export type ListLabelsFilter = {
  userId: string;
  since?: Date | undefined;
  includeDeleted?: boolean | undefined;
};

export type ListRemindersFilter = {
  userId: string;
  since?: Date | undefined;
  includeDeleted?: boolean | undefined;
};

export type ListFiltersFilter = {
  userId: string;
  since?: Date | undefined;
  includeDeleted?: boolean | undefined;
};

export type FacetStore = {
  readonly getNow: () => Date;
  readonly transaction: <T>(fn: (tx: FacetStore) => Promise<T>) => Promise<T>;

  readonly getOrCreateUser: (
    userId: string,
  ) => Promise<{ id: string; email: string; name: string }>;

  readonly isCommandProcessed: (uuid: string) => Promise<boolean>;
  readonly recordProcessedCommand: (
    uuid: string,
    userId: string,
    status: string,
  ) => Promise<void>;

  // Tasks
  readonly createTask: (data: CreateTaskInput) => Promise<Task>;
  readonly updateTask: (
    id: string,
    data: UpdateTaskInput,
  ) => Promise<Task | null>;
  readonly deleteTask: (id: string) => Promise<boolean>;
  readonly getTask: (id: string, userId?: string) => Promise<Task | null>;
  readonly listTasks: (filter: ListTasksFilter) => Promise<Task[]>;

  // Projects
  readonly createProject: (data: CreateProjectInput) => Promise<Project>;
  readonly updateProject: (
    id: string,
    data: UpdateProjectInput,
  ) => Promise<Project | null>;
  readonly deleteProject: (id: string) => Promise<boolean>;
  readonly getProject: (id: string, userId?: string) => Promise<Project | null>;
  readonly listProjects: (filter: ListProjectsFilter) => Promise<Project[]>;

  // Sections
  readonly createSection: (data: CreateSectionInput) => Promise<Section>;
  readonly updateSection: (
    id: string,
    data: UpdateSectionInput,
  ) => Promise<Section | null>;
  readonly deleteSection: (id: string) => Promise<boolean>;
  readonly listSections: (filter: ListSectionsFilter) => Promise<Section[]>;

  // Labels
  readonly createLabel: (data: CreateLabelInput) => Promise<Label>;
  readonly updateLabel: (
    id: string,
    data: UpdateLabelInput,
  ) => Promise<Label | null>;
  readonly deleteLabel: (id: string) => Promise<boolean>;
  readonly listLabels: (filter: ListLabelsFilter) => Promise<Label[]>;

  // Reminders
  readonly listReminders: (filter: ListRemindersFilter) => Promise<Reminder[]>;

  // Filters
  readonly listFilters: (filter: ListFiltersFilter) => Promise<Filter[]>;
};

export function parsePriority(priority: string | undefined): Priority {
  if (priority === Priority.P1) return Priority.P1;
  if (priority === Priority.P2) return Priority.P2;
  return priority === Priority.P3 ? Priority.P3 : Priority.P4;
}

function applyTaskDates(
  result: Task,
  p: {
    dueDate: Date | null;
    dueDatetime: Date | null;
    completedAt: Date | null;
  },
): void {
  if (p.dueDate !== null) {
    const formatted = p.dueDate.toISOString().split("T")[0];
    if (formatted !== undefined && formatted !== "")
      result.due_date = formatted;
  }
  if (p.dueDatetime !== null) result.due_datetime = p.dueDatetime.toISOString();
  if (p.completedAt !== null) result.completed_at = p.completedAt.toISOString();
}

function applyTaskStrings(
  result: Task,
  p: {
    sectionId: string | null;
    parentId: string | null;
    dueTimezone: string | null;
    dueString: string | null;
    recurrenceRule: string | null;
  },
): void {
  if (p.sectionId !== null && p.sectionId !== "")
    result.section_id = p.sectionId;
  if (p.parentId !== null && p.parentId !== "") result.parent_id = p.parentId;
  if (p.dueTimezone !== null && p.dueTimezone !== "")
    result.due_timezone = p.dueTimezone;
  if (p.dueString !== null && p.dueString !== "")
    result.due_string = p.dueString;
  if (p.recurrenceRule !== null && p.recurrenceRule !== "")
    result.recurrence_rule = p.recurrenceRule;
}

export function toProtocolTask(p: {
  id: string;
  userId: string;
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  title: string;
  description: string;
  priority: string;
  childOrder: number;
  dueDate: Date | null;
  dueDatetime: Date | null;
  dueTimezone: string | null;
  dueString: string | null;
  isRecurring: boolean;
  recurrenceRule: string | null;
  completed: boolean;
  completedAt: Date | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Task {
  const result: Task = {
    id: p.id,
    user_id: p.userId,
    project_id: p.projectId,
    title: p.title,
    description: p.description,
    priority: parsePriority(p.priority),
    child_order: p.childOrder,
    is_recurring: p.isRecurring,
    completed: p.completed,
    is_deleted: p.isDeleted,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };

  applyTaskStrings(result, p);
  applyTaskDates(result, p);
  return result;
}

export function toProtocolProject(p: {
  id: string;
  userId: string;
  name: string;
  color: string;
  parentId: string | null;
  childOrder: number;
  isInbox: boolean;
  isFavorite: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Project {
  const result: Project = {
    id: p.id,
    user_id: p.userId,
    name: p.name,
    color: p.color,
    child_order: p.childOrder,
    is_inbox: p.isInbox,
    is_favorite: p.isFavorite,
    is_archived: p.isArchived,
    is_deleted: p.isDeleted,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };

  if (p.parentId !== null && p.parentId !== "") result.parent_id = p.parentId;

  return result;
}

export function toProtocolSection(p: {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  sectionOrder: number;
  isArchived: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Section {
  return {
    id: p.id,
    project_id: p.projectId,
    user_id: p.userId,
    name: p.name,
    section_order: p.sectionOrder,
    is_archived: p.isArchived,
    is_deleted: p.isDeleted,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

export function toProtocolLabel(p: {
  id: string;
  userId: string;
  name: string;
  color: string;
  itemOrder: number;
  isFavorite: boolean;
  isDeleted: boolean;
}): Label {
  return {
    id: p.id,
    user_id: p.userId,
    name: p.name,
    color: p.color,
    item_order: p.itemOrder,
    is_favorite: p.isFavorite,
    is_deleted: p.isDeleted,
  };
}

export function toProtocolReminder(p: {
  id: string;
  taskId: string;
  reminderType: string;
  minuteOffset: number | null;
  dueDatetime: Date | null;
  isNotified: boolean;
  isDeleted: boolean;
}): Reminder {
  const result: Reminder = {
    id: p.id,
    task_id: p.taskId,
    reminder_type: p.reminderType,
    is_notified: p.isNotified,
    is_deleted: p.isDeleted,
  };
  if (p.minuteOffset !== null) result.minute_offset = p.minuteOffset;
  if (p.dueDatetime !== null) result.due_datetime = p.dueDatetime.toISOString();
  return result;
}

export function toProtocolFilter(p: {
  id: string;
  userId: string;
  name: string;
  query: string;
  color: string;
  itemOrder: number;
  isFavorite: boolean;
  isDeleted: boolean;
}): Filter {
  return {
    id: p.id,
    user_id: p.userId,
    name: p.name,
    query: p.query,
    color: p.color,
    item_order: p.itemOrder,
    is_favorite: p.isFavorite,
    is_deleted: p.isDeleted,
  };
}
