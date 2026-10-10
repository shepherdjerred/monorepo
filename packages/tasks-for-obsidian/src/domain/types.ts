import { z } from "zod";

import type {
  Task as BaseTask,
  CreateTaskRequest as BaseCreateTaskRequest,
  UpdateTaskRequest as BaseUpdateTaskRequest,
  TaskQueryFilter as _TaskQueryFilter,
  NlpParseResult as _NlpParseResult,
  CalendarEvent as _CalendarEvent,
  HealthStatus as _HealthStatus,
  TaskStats as _TaskStats,
} from "./base-schemas";

export type TaskQueryFilter = _TaskQueryFilter;
export type FilterOptions = {
  readonly statuses: readonly string[];
  readonly priorities: readonly string[];
  readonly contexts: readonly string[];
  readonly projects: readonly string[];
  readonly tags: readonly string[];
};
export type NlpParseResult = _NlpParseResult;
export type CalendarEvent = _CalendarEvent;
export type HealthStatus = _HealthStatus;
export type TaskStats = _TaskStats;

export const TaskIdSchema = z.string().brand("TaskId");
export const ProjectNameSchema = z.string().brand("ProjectName");
export const ContextNameSchema = z.string().brand("ContextName");
export const TagNameSchema = z.string().brand("TagName");

export type TaskId = z.infer<typeof TaskIdSchema>;
export type ProjectName = z.infer<typeof ProjectNameSchema>;
export type ContextName = z.infer<typeof ContextNameSchema>;
export type TagName = z.infer<typeof TagNameSchema>;

export function taskId(id: string): TaskId {
  return TaskIdSchema.parse(id);
}

export function projectName(name: string): ProjectName {
  return ProjectNameSchema.parse(name);
}

export function contextName(name: string): ContextName {
  return ContextNameSchema.parse(name);
}

export function tagName(name: string): TagName {
  return TagNameSchema.parse(name);
}

export type Task = Omit<BaseTask, "id" | "contexts" | "projects" | "tags"> & {
  readonly id: TaskId;
  readonly contexts: readonly ContextName[];
  readonly projects: readonly ProjectName[];
  readonly tags: readonly TagName[];
};

export type CreateTaskRequest = BaseCreateTaskRequest;

export type UpdateTaskRequest = BaseUpdateTaskRequest;

export type ApiResponse<T> = {
  readonly success: boolean;
  readonly data: T;
  readonly error?: string | undefined;
};
