import { z } from "zod";

import type { Priority } from "./priority";
import type { TaskStatus } from "./status";

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

export type Task = {
  readonly id: TaskId;
  readonly path: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly due?: string | undefined;
  readonly scheduled?: string | undefined;
  readonly contexts: readonly ContextName[];
  readonly projects: readonly ProjectName[];
  readonly tags: readonly TagName[];
  readonly recurrence?: string | undefined;
  readonly archived: boolean;
  readonly totalTrackedTime: number;
  readonly isBlocked: boolean;
  readonly isBlocking: boolean;
};

export type CreateTaskRequest = {
  readonly title: string;
  readonly description?: string | undefined;
  readonly status?: TaskStatus | undefined;
  readonly priority?: Priority | undefined;
  readonly due?: string | undefined;
  readonly scheduled?: string | undefined;
  readonly contexts?: readonly string[] | undefined;
  readonly projects?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly recurrence?: string | undefined;
  readonly timeEstimate?: number | undefined;
};

export type UpdateTaskRequest = {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly status?: TaskStatus | undefined;
  readonly priority?: Priority | undefined;
  readonly due?: string | null | undefined;
  readonly scheduled?: string | null | undefined;
  readonly contexts?: readonly string[] | undefined;
  readonly projects?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly recurrence?: string | null | undefined;
  readonly timeEstimate?: number | null | undefined;
};

export type TaskQueryFilter = {
  readonly status?: readonly TaskStatus[] | undefined;
  readonly priority?: readonly Priority[] | undefined;
  readonly projects?: readonly string[] | undefined;
  readonly contexts?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly dueBefore?: string | undefined;
  readonly dueAfter?: string | undefined;
  readonly hasNoDueDate?: boolean | undefined;
  readonly hasNoProject?: boolean | undefined;
  readonly search?: string | undefined;
};

export type TaskStats = {
  readonly total: number;
  readonly byStatus: Record<TaskStatus, number>;
  readonly byPriority: Record<Priority, number>;
  readonly overdue: number;
  readonly dueToday: number;
  readonly upcoming: number;
};

export type FilterOptions = {
  readonly projects: readonly string[];
  readonly contexts: readonly string[];
  readonly tags: readonly string[];
  readonly statuses: readonly TaskStatus[];
  readonly priorities: readonly Priority[];
};

export type NlpParseResult = {
  readonly title: string;
  readonly due?: string | undefined;
  readonly priority?: Priority | undefined;
  readonly projects?: readonly string[] | undefined;
  readonly contexts?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly recurrence?: string | undefined;
};

export type TimeEntry = {
  readonly taskId: TaskId;
  readonly startTime: string;
  readonly endTime?: string | undefined;
  readonly duration?: number | undefined;
};

export type TimeSummary = {
  readonly totalTime: number;
  readonly entries: readonly TimeEntry[];
};

export type PomodoroStatus = {
  readonly active: boolean;
  readonly taskId?: TaskId | undefined;
  readonly timeRemaining?: number | undefined;
  readonly type?: "work" | "break" | undefined;
};

export type CalendarEvent = {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly taskId?: TaskId | undefined;
};

export type HealthStatus = {
  readonly status: "ok" | "error";
  readonly version?: string | undefined;
  readonly uptime?: number | undefined;
};

export type ApiResponse<T> = {
  readonly success: boolean;
  readonly data: T;
  readonly error?: string | undefined;
};
