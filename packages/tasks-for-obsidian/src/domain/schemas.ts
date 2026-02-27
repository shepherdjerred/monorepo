import { z } from "zod";

import type {
  CalendarEvent,
  FilterOptions,
  HealthStatus,
  NlpParseResult,
  PomodoroStatus,
  Task,
  TaskStats,
  TimeEntry,
  TimeSummary,
} from "./types";
import { contextName, projectName, tagName, taskId } from "./types";

const PrioritySchema = z.enum(["highest", "high", "medium", "normal", "low", "none"]);
export const TaskStatusSchema = z.enum(["open", "in-progress", "done", "cancelled", "waiting", "delegated"]);

export const TaskSchema = z.object({
  id: z.string(),
  path: z.string().default(""),
  title: z.string(),
  status: TaskStatusSchema.default("open"),
  priority: PrioritySchema.default("normal"),
  due: z.string().optional(),
  scheduled: z.string().optional(),
  contexts: z.array(z.string()).default([]),
  projects: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  recurrence: z.string().optional(),
  archived: z.boolean().default(false),
  totalTrackedTime: z.number().default(0),
  isBlocked: z.boolean().default(false),
  isBlocking: z.boolean().default(false),
}).transform((raw): Task => ({
  id: taskId(raw.id),
  path: raw.path,
  title: raw.title,
  status: raw.status,
  priority: raw.priority,
  due: raw.due,
  scheduled: raw.scheduled,
  contexts: raw.contexts.map((c) => contextName(c)),
  projects: raw.projects.map((p) => projectName(p)),
  tags: raw.tags.map((t) => tagName(t)),
  recurrence: raw.recurrence,
  archived: raw.archived,
  totalTrackedTime: raw.totalTrackedTime,
  isBlocked: raw.isBlocked,
  isBlocking: raw.isBlocking,
}));

export const TaskListSchema = z.object({
  tasks: z.array(TaskSchema),
  pagination: z.object({
    total: z.number(),
    offset: z.number(),
    limit: z.number(),
    hasMore: z.boolean(),
  }),
  vault: z.object({
    name: z.string(),
    path: z.string(),
  }).optional(),
  note: z.string().optional(),
});

// Single task responses: after envelope unwrapping, data IS the task
export const TaskResponseSchema = TaskSchema;
export const CreateTaskResponseSchema = TaskSchema;

export const TaskStatsSchema = z.object({
  total: z.number(),
  byStatus: z.record(TaskStatusSchema, z.number()),
  byPriority: z.record(PrioritySchema, z.number()),
  overdue: z.number(),
  dueToday: z.number(),
  upcoming: z.number(),
}).transform((raw): TaskStats => ({
  ...raw,
  byStatus: {
    "open": 0, "in-progress": 0, "done": 0, "cancelled": 0, "waiting": 0, "delegated": 0,
    ...raw.byStatus,
  },
  byPriority: {
    "highest": 0, "high": 0, "medium": 0, "normal": 0, "low": 0, "none": 0,
    ...raw.byPriority,
  },
}));

export const FilterOptionsSchema = z.object({
  projects: z.array(z.string()),
  contexts: z.array(z.string()),
  tags: z.array(z.string()),
  statuses: z.array(TaskStatusSchema),
  priorities: z.array(PrioritySchema),
}).transform((raw): FilterOptions => raw);

export const NlpParseResultSchema = z.object({
  title: z.string(),
  due: z.string().optional(),
  priority: PrioritySchema.optional(),
  projects: z.array(z.string()).optional(),
  contexts: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  recurrence: z.string().optional(),
}).transform((raw): NlpParseResult => raw);

export const TimeEntrySchema = z.object({
  taskId: z.string(),
  startTime: z.string(),
  endTime: z.string().optional(),
  duration: z.number().optional(),
}).transform((raw): TimeEntry => ({
  ...raw,
  taskId: taskId(raw.taskId),
}));

export const TimeSummarySchema = z.object({
  totalTime: z.number(),
  entries: z.array(TimeEntrySchema),
}).transform((raw): TimeSummary => raw);

export const PomodoroStatusSchema = z.object({
  active: z.boolean(),
  taskId: z.string().optional(),
  timeRemaining: z.number().optional(),
  type: z.enum(["work", "break"]).optional(),
}).transform((raw): PomodoroStatus => ({
  ...raw,
  taskId: raw.taskId ? taskId(raw.taskId) : undefined,
}));

export const CalendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string(),
  taskId: z.string().optional(),
}).transform((raw): CalendarEvent => ({
  ...raw,
  taskId: raw.taskId ? taskId(raw.taskId) : undefined,
}));

export const CalendarEventsSchema = z.object({
  events: z.array(CalendarEventSchema),
});

export const HealthStatusSchema = z.object({
  status: z.enum(["ok", "error"]),
  version: z.string().optional(),
  uptime: z.number().optional(),
}).transform((raw): HealthStatus => raw);

export const ApiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema,
    error: z.string().optional(),
  });

export const DeleteResponseSchema = z.object({
  success: z.boolean(),
});

export const QueryResponseSchema = z.object({
  tasks: z.array(TaskSchema),
  total: z.number(),
});
