export type Priority = "highest" | "high" | "medium" | "normal" | "low" | "none";

export const ALL_PRIORITIES: readonly Priority[] = [
  "highest",
  "high",
  "medium",
  "normal",
  "low",
  "none",
] as const;

export type TaskStatus =
  | "open"
  | "in-progress"
  | "done"
  | "cancelled"
  | "waiting"
  | "delegated";

export const ALL_STATUSES: readonly TaskStatus[] = [
  "open",
  "in-progress",
  "done",
  "cancelled",
  "waiting",
  "delegated",
] as const;

export type Task = {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly due?: string | undefined;
  readonly scheduled?: string | undefined;
  readonly contexts: readonly string[];
  readonly projects: readonly string[];
  readonly tags: readonly string[];
  readonly recurrence?: string | undefined;
  readonly archived: boolean;
  readonly totalTrackedTime: number;
  readonly isBlocked: boolean;
  readonly isBlocking: boolean;
  readonly description?: string | undefined;
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
  readonly taskId: string;
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
  readonly taskId?: string | undefined;
  readonly timeRemaining?: number | undefined;
  readonly type?: "work" | "break" | undefined;
};

export type CalendarEvent = {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly taskId?: string | undefined;
};

export type HealthStatus = {
  readonly status: "ok" | "error";
  readonly version?: string | undefined;
  readonly uptime?: number | undefined;
};
