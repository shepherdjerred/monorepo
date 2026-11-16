import {
  type Filter,
  type Label,
  Priority,
  type Project,
  type Reminder,
  type Section,
  type Task,
} from "../protocol/generated.ts";
import type { CreateTaskInput, UpdateTaskInput } from "./types.ts";

export type InternalTask = Task & { _updatedAt: Date };
export type InternalProject = Project & { _updatedAt: Date };
export type InternalSection = Section & { _updatedAt: Date };
export type InternalLabel = Label & { _updatedAt: Date };
export type InternalReminder = Reminder & { _createdAt: Date };
export type InternalFilter = Filter & { _updatedAt: Date };

export class MonotonicClock {
  private last = 0;
  now(): Date {
    const current = Date.now();
    this.last = current > this.last ? current : this.last + 1;
    return new Date(this.last);
  }
}

export function parsePriority(
  priority: Priority | string | undefined,
): Priority {
  if (priority === Priority.P1) return Priority.P1;
  if (priority === Priority.P2) return Priority.P2;
  return priority === Priority.P3 ? Priority.P3 : Priority.P4;
}

export function applyCreateStrings(
  task: InternalTask,
  data: CreateTaskInput,
): void {
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

export function applyCreateDates(
  task: InternalTask,
  data: CreateTaskInput,
): void {
  if (data.dueDate !== undefined && data.dueDate !== null) {
    const formatted = data.dueDate.toISOString().split("T")[0];
    if (formatted !== undefined && formatted !== "") task.due_date = formatted;
  }
  if (data.dueDatetime !== undefined && data.dueDatetime !== null) {
    task.due_datetime = data.dueDatetime.toISOString();
  }
  if (data.completedAt !== undefined && data.completedAt !== null) {
    task.completed_at = data.completedAt.toISOString();
  }
}

export function applyTaskCreateOptions(
  task: InternalTask,
  data: CreateTaskInput,
): void {
  applyCreateStrings(task, data);
  applyCreateDates(task, data);
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
  if (d === undefined) return undefined;
  return d === null ? null : d.toISOString().split("T")[0];
}

export function formatIso(
  d: Date | null | undefined,
): string | null | undefined {
  if (d === undefined) return undefined;
  return d === null ? null : d.toISOString();
}

export function applyUpdateStrings(
  task: InternalTask,
  data: UpdateTaskInput,
): void {
  if (data.title !== undefined) task.title = data.title;
  if (data.description !== undefined) task.description = data.description;
  if (data.priority !== undefined) task.priority = parsePriority(data.priority);
  if (data.projectId !== undefined) task.project_id = data.projectId;
  setOrDelete(task, "section_id", data.sectionId);
  setOrDelete(task, "parent_id", data.parentId);
}

export function applyUpdateFlags(
  task: InternalTask,
  data: UpdateTaskInput,
): void {
  if (data.childOrder !== undefined) task.child_order = data.childOrder;
  if (data.isRecurring !== undefined) task.is_recurring = data.isRecurring;
  if (data.completed !== undefined) task.completed = data.completed;
  if (data.isDeleted !== undefined) task.is_deleted = data.isDeleted;
}

export function applyTaskUpdateOptions(
  task: InternalTask,
  data: UpdateTaskInput,
): void {
  applyUpdateStrings(task, data);
  applyUpdateFlags(task, data);
}

export function applyUpdateDates(
  task: InternalTask,
  data: UpdateTaskInput,
): void {
  setOrDelete(task, "due_date", formatDueDate(data.dueDate));
  setOrDelete(task, "due_datetime", formatIso(data.dueDatetime));
  setOrDelete(task, "completed_at", formatIso(data.completedAt));
}

export function applyUpdateOptionals(
  task: InternalTask,
  data: UpdateTaskInput,
): void {
  setOrDelete(task, "due_timezone", data.dueTimezone);
  setOrDelete(task, "due_string", data.dueString);
  setOrDelete(task, "recurrence_rule", data.recurrenceRule);
}

export function applyTaskUpdateDates(
  task: InternalTask,
  data: UpdateTaskInput,
): void {
  applyUpdateDates(task, data);
  applyUpdateOptionals(task, data);
}
