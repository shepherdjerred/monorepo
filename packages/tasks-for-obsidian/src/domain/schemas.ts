import { z } from "zod";

const prioritySchema = z.enum(["highest", "high", "medium", "normal", "low", "none"]);
const taskStatusSchema = z.enum(["open", "in-progress", "done", "cancelled", "waiting", "delegated"]);

export const taskSchema = z.object({
  id: z.string(),
  path: z.string().default(""),
  title: z.string(),
  status: taskStatusSchema.default("open"),
  priority: prioritySchema.default("normal"),
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
});

export const taskListSchema = z.object({
  tasks: z.array(taskSchema),
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
export const taskResponseSchema = taskSchema;
export const createTaskResponseSchema = taskSchema;

export const taskStatsSchema = z.object({
  total: z.number(),
  byStatus: z.record(taskStatusSchema, z.number()),
  byPriority: z.record(prioritySchema, z.number()),
  overdue: z.number(),
  dueToday: z.number(),
  upcoming: z.number(),
});

export const filterOptionsSchema = z.object({
  projects: z.array(z.string()),
  contexts: z.array(z.string()),
  tags: z.array(z.string()),
  statuses: z.array(taskStatusSchema),
  priorities: z.array(prioritySchema),
});

export const nlpParseResultSchema = z.object({
  title: z.string(),
  due: z.string().optional(),
  priority: prioritySchema.optional(),
  projects: z.array(z.string()).optional(),
  contexts: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  recurrence: z.string().optional(),
});

export const timeEntrySchema = z.object({
  taskId: z.string(),
  startTime: z.string(),
  endTime: z.string().optional(),
  duration: z.number().optional(),
});

export const timeSummarySchema = z.object({
  totalTime: z.number(),
  entries: z.array(timeEntrySchema),
});

export const pomodoroStatusSchema = z.object({
  active: z.boolean(),
  taskId: z.string().optional(),
  timeRemaining: z.number().optional(),
  type: z.enum(["work", "break"]).optional(),
});

export const calendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string(),
  taskId: z.string().optional(),
});

export const calendarEventsSchema = z.object({
  events: z.array(calendarEventSchema),
});

export const healthStatusSchema = z.object({
  status: z.enum(["ok", "error"]),
  version: z.string().optional(),
  uptime: z.number().optional(),
});

export const apiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema,
    error: z.string().optional(),
  });

export const deleteResponseSchema = z.object({
  success: z.boolean(),
});

export const queryResponseSchema = z.object({
  tasks: z.array(taskSchema),
  total: z.number(),
});
