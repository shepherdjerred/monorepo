import type {
  CommentUpload,
  Filter,
  Label,
  Priority,
  Project,
  Reminder,
  RecurrenceBasis,
  Section,
  Task,
} from "../protocol/generated.ts";
import type {
  ApiTokenSummary,
  AuditContext,
  AuthenticatedApiToken,
  CreateApiTokenInput,
  ListMutationsFilter,
  MutationPage,
} from "./auth-types.ts";

export class EntityNotFoundError extends Error {
  readonly entity: string;
  readonly entityId: string;

  constructor(entity: string, entityId: string) {
    super(`${entity} not found: ${entityId}`);
    this.name = "EntityNotFoundError";
    this.entity = entity;
    this.entityId = entityId;
  }
}

export type ProcessedCommandRecord = {
  status: string;
  resultId: string | null;
};

export type TaskScheduleOptions = {
  childOrder?: number | undefined;
  deadline?: Date | null | undefined;
  recurrenceBasis?: RecurrenceBasis | undefined;
  dueDate?: Date | null | undefined;
  dueDatetime?: Date | null | undefined;
  dueTimezone?: string | null | undefined;
  dueString?: string | null | undefined;
  isRecurring?: boolean | undefined;
  recurrenceRule?: string | null | undefined;
  completed?: boolean | undefined;
  completedAt?: Date | null | undefined;
  labelIds?: string[] | undefined;
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
  appendComment?: CommentUpload | undefined;
  removeCommentId?: string | undefined;
  removeAttachmentId?: string | undefined;
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

export type CreateReminderInput = {
  id?: string | undefined;
  userId: string;
  taskId: string;
  reminderType: string;
  minuteOffset?: number | null | undefined;
  dueDatetime?: Date | null | undefined;
  isNotified?: boolean | undefined;
};

export type UpdateReminderInput = {
  reminderType?: string | undefined;
  minuteOffset?: number | null | undefined;
  dueDatetime?: Date | null | undefined;
  isNotified?: boolean | undefined;
  isDeleted?: boolean | undefined;
};

export type CreateFilterInput = {
  id?: string | undefined;
  userId: string;
  name: string;
  query: string;
  color?: string | undefined;
  itemOrder?: number | undefined;
  isFavorite?: boolean | undefined;
};

export type UpdateFilterInput = {
  name?: string | undefined;
  query?: string | undefined;
  color?: string | undefined;
  itemOrder?: number | undefined;
  isFavorite?: boolean | undefined;
  isDeleted?: boolean | undefined;
};

export type BaseListFilter = {
  userId: string;
  since?: Date | undefined;
  sinceSeq?: bigint | undefined;
  includeDeleted?: boolean | undefined;
};

export type ListTasksFilter = BaseListFilter & {
  projectId?: string | undefined;
};

export type ListProjectsFilter = BaseListFilter;

export type ListSectionsFilter = BaseListFilter & {
  projectId?: string | undefined;
};

export type ListLabelsFilter = BaseListFilter;

export type ListRemindersFilter = BaseListFilter & {
  taskId?: string | undefined;
};

export type ListFiltersFilter = BaseListFilter;

export type FacetStore = {
  readonly getNow: () => Date;
  readonly withAuditContext: (ctx: AuditContext | undefined) => FacetStore;
  readonly getAuditContext: () => AuditContext | undefined;
  readonly transaction: <T>(fn: (tx: FacetStore) => Promise<T>) => Promise<T>;
  readonly runInSavepoint: <T>(
    name: string,
    fn: () => Promise<T>,
  ) => Promise<T>;

  readonly getOrCreateUser: (
    userId: string,
  ) => Promise<{ id: string; email: string; name: string }>;
  readonly getSyncSequence: (userId: string) => Promise<bigint>;

  readonly getProcessedCommand: (
    uuid: string,
  ) => Promise<ProcessedCommandRecord | null>;
  readonly recordProcessedCommand: (
    uuid: string,
    userId: string,
    status: string,
    resultId?: string | null,
  ) => Promise<void>;

  readonly createApiToken: (
    data: CreateApiTokenInput,
  ) => Promise<ApiTokenSummary>;
  readonly listApiTokens: (
    userId: string,
    options?: { includeRevoked?: boolean | undefined },
  ) => Promise<ApiTokenSummary[]>;
  readonly revokeApiToken: (
    id: string,
    userId: string,
  ) => Promise<ApiTokenSummary | null>;
  readonly authenticateApiToken: (
    tokenHash: string,
  ) => Promise<AuthenticatedApiToken | null>;
  readonly listMutations: (
    filter: ListMutationsFilter,
  ) => Promise<MutationPage>;

  readonly countActiveTasks: () => Promise<number>;
  readonly getAttachment: (
    taskId: string,
    commentId: string,
    userId: string,
  ) => Promise<Uint8Array<ArrayBuffer> | null>;

  readonly createTask: (data: CreateTaskInput) => Promise<Task>;
  readonly updateTask: (
    id: string,
    userId: string,
    data: UpdateTaskInput,
  ) => Promise<Task | null>;
  readonly completeTask: (
    id: string,
    userId: string,
    completedAt?: Date,
  ) => Promise<Task | null>;
  readonly deleteTask: (id: string, userId: string) => Promise<boolean>;
  readonly getTask: (id: string, userId?: string) => Promise<Task | null>;
  readonly listTasks: (filter: ListTasksFilter) => Promise<Task[]>;

  readonly createProject: (data: CreateProjectInput) => Promise<Project>;
  readonly updateProject: (
    id: string,
    userId: string,
    data: UpdateProjectInput,
  ) => Promise<Project | null>;
  readonly deleteProject: (id: string, userId: string) => Promise<boolean>;
  readonly getProject: (id: string, userId?: string) => Promise<Project | null>;
  readonly listProjects: (filter: ListProjectsFilter) => Promise<Project[]>;

  readonly createSection: (data: CreateSectionInput) => Promise<Section>;
  readonly updateSection: (
    id: string,
    userId: string,
    data: UpdateSectionInput,
  ) => Promise<Section | null>;
  readonly deleteSection: (id: string, userId: string) => Promise<boolean>;
  readonly getSection: (id: string, userId?: string) => Promise<Section | null>;
  readonly listSections: (filter: ListSectionsFilter) => Promise<Section[]>;

  readonly createLabel: (data: CreateLabelInput) => Promise<Label>;
  readonly updateLabel: (
    id: string,
    userId: string,
    data: UpdateLabelInput,
  ) => Promise<Label | null>;
  readonly deleteLabel: (id: string, userId: string) => Promise<boolean>;
  readonly getLabel: (id: string, userId?: string) => Promise<Label | null>;
  readonly listLabels: (filter: ListLabelsFilter) => Promise<Label[]>;

  readonly createReminder: (data: CreateReminderInput) => Promise<Reminder>;
  readonly updateReminder: (
    id: string,
    userId: string,
    data: UpdateReminderInput,
  ) => Promise<Reminder | null>;
  readonly deleteReminder: (id: string, userId: string) => Promise<boolean>;
  readonly getReminder: (
    id: string,
    userId?: string,
  ) => Promise<Reminder | null>;
  readonly listReminders: (filter: ListRemindersFilter) => Promise<Reminder[]>;

  readonly createFilter: (data: CreateFilterInput) => Promise<Filter>;
  readonly updateFilter: (
    id: string,
    userId: string,
    data: UpdateFilterInput,
  ) => Promise<Filter | null>;
  readonly deleteFilter: (id: string, userId: string) => Promise<boolean>;
  readonly getFilter: (id: string, userId?: string) => Promise<Filter | null>;
  readonly listFilters: (filter: ListFiltersFilter) => Promise<Filter[]>;
};
