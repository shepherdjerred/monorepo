import {
  type Filter,
  type Label,
  type Project,
  type Reminder,
  type Section,
  type Task,
} from "../../protocol/generated.ts";
import { parsePriority } from "../mappers.ts";
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

export function newMemoryTask(
  data: CreateTaskInput,
  id: string,
  nowIso: string,
  labelIds: string[],
): Task {
  const task: Task = {
    id,
    user_id: data.userId,
    project_id: data.projectId,
    title: data.title,
    description: data.description ?? "",
    priority: parsePriority(data.priority),
    child_order: data.childOrder ?? 0,
    is_recurring: data.isRecurring ?? false,
    label_ids: labelIds,
    completed: data.completed ?? false,
    is_deleted: false,
    created_at: nowIso,
    updated_at: nowIso,
  };
  applyTaskCreateOptions(task, data);
  return task;
}

export type StoredEntry<T> = {
  value: T;
  userId: string;
  updatedAt: Date;
  syncSeq: bigint;
};

export type StoredUser = {
  id: string;
  email: string;
  name: string;
  syncSequence: bigint;
};

export class MonotonicClock {
  private last = 0;

  now(): Date {
    const current = Date.now();
    this.last = current > this.last ? current : this.last + 1;
    return new Date(this.last);
  }

  snapshot(): number {
    return this.last;
  }

  restore(saved: number): void {
    this.last = saved;
  }
}

function matchesEntryFilter<T extends { is_deleted: boolean }>(
  entry: StoredEntry<T>,
  filter: BaseListFilter,
  sinceTime: number | undefined,
): boolean {
  if (entry.userId !== filter.userId) {
    return false;
  }
  if (filter.includeDeleted !== true && entry.value.is_deleted) {
    return false;
  }
  return filter.sinceSeq === undefined
    ? sinceTime === undefined || entry.updatedAt.getTime() > sinceTime
    : entry.syncSeq > filter.sinceSeq;
}

export function queryStoredEntries<T extends { is_deleted: boolean }>(
  map: Map<string, StoredEntry<T>>,
  filter: BaseListFilter,
  options?: {
    predicate?: ((item: T) => boolean) | undefined;
    compare?: ((a: T, b: T) => number) | undefined;
  },
): T[] {
  const sinceTime = filter.since?.getTime();
  const matched: T[] = [];

  for (const entry of map.values()) {
    if (!matchesEntryFilter(entry, filter, sinceTime)) {
      continue;
    }
    if (options?.predicate !== undefined && !options.predicate(entry.value)) {
      continue;
    }
    matched.push(structuredClone(entry.value));
  }

  if (options?.compare !== undefined) {
    matched.sort(options.compare);
  }
  return matched;
}

export function restoreMap<K, V>(target: Map<K, V>, snapshot: Map<K, V>): void {
  target.clear();
  for (const [k, v] of snapshot.entries()) {
    target.set(k, v);
  }
}

export function setOrDelete<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | null | undefined,
): void {
  if (value === null) {
    Reflect.deleteProperty(target, key);
  } else if (value !== undefined) {
    target[key] = value;
  }
}

export function formatDueDate(
  d: Date | null | undefined,
): string | null | undefined {
  return d === undefined
    ? undefined
    : d === null
      ? null
      : (d.toISOString().split("T")[0] ?? null);
}

export function formatIso(
  d: Date | null | undefined,
): string | null | undefined {
  return d === undefined ? undefined : d === null ? null : d.toISOString();
}

function applyCreateTaskStrings(task: Task, data: CreateTaskInput): void {
  if (
    data.sectionId !== undefined &&
    data.sectionId !== null &&
    data.sectionId !== ""
  ) {
    task.section_id = data.sectionId;
  }
  if (
    data.parentId !== undefined &&
    data.parentId !== null &&
    data.parentId !== ""
  ) {
    task.parent_id = data.parentId;
  }
  if (
    data.dueTimezone !== undefined &&
    data.dueTimezone !== null &&
    data.dueTimezone !== ""
  ) {
    task.due_timezone = data.dueTimezone;
  }
  if (
    data.dueString !== undefined &&
    data.dueString !== null &&
    data.dueString !== ""
  ) {
    task.due_string = data.dueString;
  }
  if (
    data.recurrenceRule !== undefined &&
    data.recurrenceRule !== null &&
    data.recurrenceRule !== ""
  ) {
    task.recurrence_rule = data.recurrenceRule;
  }
}

export function applyTaskCreateOptions(
  task: Task,
  data: CreateTaskInput,
): void {
  applyCreateTaskStrings(task, data);
  setOrDelete(task, "deadline", formatDueDate(data.deadline));
  setOrDelete(task, "recurrence_basis", data.recurrenceBasis);

  const dueDate = formatDueDate(data.dueDate);
  if (dueDate !== undefined && dueDate !== null && dueDate !== "") {
    task.due_date = dueDate;
  }
  const dueDatetime = formatIso(data.dueDatetime);
  if (dueDatetime !== undefined && dueDatetime !== null) {
    task.due_datetime = dueDatetime;
  }
  const completedAt = formatIso(data.completedAt);
  if (completedAt !== undefined && completedAt !== null) {
    task.completed_at = completedAt;
  }
}

export function applyTaskUpdateFields(task: Task, data: UpdateTaskInput): void {
  if (data.title !== undefined) {
    task.title = data.title;
  }
  if (data.description !== undefined) {
    task.description = data.description;
  }
  if (data.priority !== undefined) {
    task.priority = parsePriority(data.priority);
  }
  if (data.projectId !== undefined) {
    task.project_id = data.projectId;
  }
  setOrDelete(task, "section_id", data.sectionId);
  setOrDelete(task, "parent_id", data.parentId);
  if (data.childOrder !== undefined) {
    task.child_order = data.childOrder;
  }
  if (data.isRecurring !== undefined) {
    task.is_recurring = data.isRecurring;
  }
  if (data.completed !== undefined) {
    task.completed = data.completed;
  }
  if (data.isDeleted !== undefined) {
    task.is_deleted = data.isDeleted;
  }
  if (data.labelIds !== undefined) {
    task.label_ids = [...new Set(data.labelIds)];
  }
}

export function applyTaskUpdateDates(task: Task, data: UpdateTaskInput): void {
  setOrDelete(task, "deadline", formatDueDate(data.deadline));
  setOrDelete(task, "recurrence_basis", data.recurrenceBasis);
  setOrDelete(task, "due_date", formatDueDate(data.dueDate));
  setOrDelete(task, "due_datetime", formatIso(data.dueDatetime));
  setOrDelete(task, "completed_at", formatIso(data.completedAt));
  setOrDelete(task, "due_timezone", data.dueTimezone);
  setOrDelete(task, "due_string", data.dueString);
  setOrDelete(task, "recurrence_rule", data.recurrenceRule);
}

export function applyProjectUpdate(
  project: Project,
  data: UpdateProjectInput,
): void {
  if (data.name !== undefined) {
    project.name = data.name;
  }
  if (data.color !== undefined) {
    project.color = data.color;
  }
  setOrDelete(project, "parent_id", data.parentId);
  if (data.childOrder !== undefined) {
    project.child_order = data.childOrder;
  }
  if (data.isFavorite !== undefined) {
    project.is_favorite = data.isFavorite;
  }
  if (data.isArchived !== undefined) {
    project.is_archived = data.isArchived;
  }
  if (data.isDeleted !== undefined) {
    project.is_deleted = data.isDeleted;
  }
}

export function applySectionUpdate(
  section: Section,
  data: UpdateSectionInput,
): void {
  if (data.name !== undefined) {
    section.name = data.name;
  }
  if (data.sectionOrder !== undefined) {
    section.section_order = data.sectionOrder;
  }
  if (data.isArchived !== undefined) {
    section.is_archived = data.isArchived;
  }
  if (data.isDeleted !== undefined) {
    section.is_deleted = data.isDeleted;
  }
}

export function applyLabelUpdate(label: Label, data: UpdateLabelInput): void {
  if (data.name !== undefined) {
    label.name = data.name;
  }
  if (data.color !== undefined) {
    label.color = data.color;
  }
  if (data.itemOrder !== undefined) {
    label.item_order = data.itemOrder;
  }
  if (data.isFavorite !== undefined) {
    label.is_favorite = data.isFavorite;
  }
  if (data.isDeleted !== undefined) {
    label.is_deleted = data.isDeleted;
  }
}

export function applyReminderUpdate(
  reminder: Reminder,
  data: UpdateReminderInput,
): void {
  if (data.reminderType !== undefined) {
    reminder.reminder_type = data.reminderType;
  }
  setOrDelete(reminder, "minute_offset", data.minuteOffset);
  setOrDelete(reminder, "due_datetime", formatIso(data.dueDatetime));
  if (data.isNotified !== undefined) {
    reminder.is_notified = data.isNotified;
  }
  if (data.isDeleted !== undefined) {
    reminder.is_deleted = data.isDeleted;
  }
}

export function applyFilterUpdate(
  filter: Filter,
  data: UpdateFilterInput,
): void {
  if (data.name !== undefined) {
    filter.name = data.name;
  }
  if (data.query !== undefined) {
    filter.query = data.query;
  }
  if (data.color !== undefined) {
    filter.color = data.color;
  }
  if (data.itemOrder !== undefined) {
    filter.item_order = data.itemOrder;
  }
  if (data.isFavorite !== undefined) {
    filter.is_favorite = data.isFavorite;
  }
  if (data.isDeleted !== undefined) {
    filter.is_deleted = data.isDeleted;
  }
}

export function assertOwnedEntry<T>(
  map: Map<string, StoredEntry<T>>,
  id: string,
  userId: string,
  entityName: string,
): StoredEntry<T> {
  const entry = map.get(id);
  if (entry?.userId !== userId) {
    throw new EntityNotFoundError(entityName, id);
  }
  return entry;
}
