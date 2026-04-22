import { z } from "zod";

// ── Enums ──────────────────────────────────────────────────────

export const PrioritySchema = z.enum([
  "highest",
  "high",
  "medium",
  "normal",
  "low",
  "none",
]);
export type Priority = z.infer<typeof PrioritySchema>;
export const ALL_PRIORITIES = PrioritySchema.options;

export const TaskStatusSchema = z.enum([
  "open",
  "in-progress",
  "done",
  "cancelled",
  "waiting",
  "delegated",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export const ALL_STATUSES = TaskStatusSchema.options;

// ── Task ───────────────────────────────────────────────────────

export const RecurrenceAnchorSchema = z.enum(["scheduled", "completion"]);
export type RecurrenceAnchor = z.infer<typeof RecurrenceAnchorSchema>;

export const BlockedByEntrySchema = z.object({
  uid: z.string(),
  reltype: z.string().optional(),
  gap: z.string().optional(),
});

export const ReminderSchema = z.object({
  type: z.enum(["relative", "absolute"]),
  offset: z.string().optional(),
  relatedTo: z.string().optional(),
  absoluteTime: z.string().optional(),
});

export const InlineTimeEntrySchema = z.object({
  startTime: z.string(),
  endTime: z.string().optional(),
  duration: z.number().optional(),
});

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
  recurrenceAnchor: RecurrenceAnchorSchema.optional(),
  completeInstances: z.array(z.string()).default([]),
  skippedInstances: z.array(z.string()).default([]),
  completedDate: z.string().optional(),
  dateCreated: z.string().optional(),
  dateModified: z.string().optional(),
  timeEstimate: z.number().optional(),
  timeEntries: z.array(InlineTimeEntrySchema).default([]),
  blockedBy: z.array(BlockedByEntrySchema).default([]),
  reminders: z.array(ReminderSchema).default([]),
  archived: z.boolean().default(false),
  totalTrackedTime: z.number().default(0),
  isBlocked: z.boolean().default(false),
  isBlocking: z.boolean().default(false),
  googleCalendarEventId: z.string().optional(),
  icsEventId: z.string().optional(),
  extraFields: z.record(z.string(), z.unknown()).default({}),
  details: z.string().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

// ── Requests ───────────────────────────────────────────────────

export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1),
  details: z.string().optional(),
  status: TaskStatusSchema.optional(),
  priority: PrioritySchema.optional(),
  due: z.string().optional(),
  scheduled: z.string().optional(),
  contexts: z.array(z.string()).optional(),
  projects: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  recurrence: z.string().optional(),
  recurrenceAnchor: RecurrenceAnchorSchema.optional(),
  timeEstimate: z.number().optional(),
  extraFields: z.record(z.string(), z.unknown()).optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const UpdateTaskRequestSchema = z.object({
  title: z.string().min(1).optional(),
  details: z.string().optional(),
  status: TaskStatusSchema.optional(),
  priority: PrioritySchema.optional(),
  due: z.string().nullable().optional(),
  scheduled: z.string().nullable().optional(),
  contexts: z.array(z.string()).optional(),
  projects: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  recurrence: z.string().nullable().optional(),
  recurrenceAnchor: RecurrenceAnchorSchema.nullable().optional(),
  timeEstimate: z.number().nullable().optional(),
  extraFields: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;

export const NlpRequestSchema = z.object({
  text: z.string().min(1),
});
export type NlpRequest = z.infer<typeof NlpRequestSchema>;

export const TaskQueryFilterSchema = z.object({
  status: z.array(TaskStatusSchema).optional(),
  priority: z.array(PrioritySchema).optional(),
  projects: z.array(z.string()).optional(),
  contexts: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  dueBefore: z.string().optional(),
  dueAfter: z.string().optional(),
  hasNoDueDate: z.boolean().optional(),
  hasNoProject: z.boolean().optional(),
  search: z.string().optional(),
});
export type TaskQueryFilter = z.infer<typeof TaskQueryFilterSchema>;

// ── FilterQuery (upstream tree format) ─────────────────────────

const FilterConditionSchema = z.object({
  type: z.literal("condition"),
  id: z.string(),
  property: z.string(),
  operator: z.string(),
  value: z.unknown(),
});

type FilterGroup = {
  type: "group";
  id: string;
  conjunction: "and" | "or";
  children: FilterNode[];
};

type FilterNode = z.infer<typeof FilterConditionSchema> | FilterGroup;

const FilterNodeSchema: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([FilterConditionSchema, FilterGroupSchema]),
);

const FilterGroupSchema: z.ZodType<FilterGroup> = z.object({
  type: z.literal("group"),
  id: z.string(),
  conjunction: z.enum(["and", "or"]),
  children: z.array(FilterNodeSchema),
});

export const FilterQuerySchema = z.object({
  type: z.literal("group"),
  id: z.string(),
  conjunction: z.enum(["and", "or"]),
  children: z.array(FilterNodeSchema),
  sortKey: z.string().optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  groupKey: z.string().optional(),
  subgroupKey: z.string().optional(),
});
export type FilterQuery = z.infer<typeof FilterQuerySchema>;

// ── Responses ──────────────────────────────────────────────────

export const ApiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema,
    error: z.string().optional(),
  });

export const TaskListResponseSchema = z.object({
  tasks: z.array(TaskSchema),
  pagination: z.object({
    total: z.number(),
    offset: z.number(),
    limit: z.number(),
    hasMore: z.boolean(),
  }),
  vault: z
    .object({
      name: z.string(),
      path: z.string(),
    })
    .optional(),
  note: z.string().optional(),
});
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

export const QueryResponseSchema = z.object({
  tasks: z.array(TaskSchema),
  total: z.number(),
});
export type QueryResponse = z.infer<typeof QueryResponseSchema>;

export const TaskStatsSchema = z.object({
  total: z.number(),
  completed: z.number(),
  active: z.number(),
  overdue: z.number(),
  archived: z.number(),
  withTimeTracking: z.number(),
});
export type TaskStats = z.infer<typeof TaskStatsSchema>;

export const FilterOptionsSchema = z.object({
  projects: z.array(z.string()),
  contexts: z.array(z.string()),
  tags: z.array(z.string()),
  statuses: z.array(TaskStatusSchema),
  priorities: z.array(PrioritySchema),
});
export type FilterOptions = z.infer<typeof FilterOptionsSchema>;

export const NlpParseResultSchema = z.object({
  title: z.string(),
  due: z.string().optional(),
  priority: PrioritySchema.optional(),
  projects: z.array(z.string()).optional(),
  contexts: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  recurrence: z.string().optional(),
});
export type NlpParseResult = z.infer<typeof NlpParseResultSchema>;

export const DeleteResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteResponse = z.infer<typeof DeleteResponseSchema>;

// ── Time Tracking ──────────────────────────────────────────────

export const TimeEntrySchema = z.object({
  taskId: z.string(),
  startTime: z.string(),
  endTime: z.string().optional(),
  duration: z.number().optional(),
});
export type TimeEntry = z.infer<typeof TimeEntrySchema>;

export const TimeSummarySchema = z.object({
  totalTime: z.number(),
  entries: z.array(TimeEntrySchema),
});
export type TimeSummary = z.infer<typeof TimeSummarySchema>;

// ── Pomodoro ───────────────────────────────────────────────────

export const PomodoroStatusSchema = z.object({
  active: z.boolean(),
  taskId: z.string().optional(),
  timeRemaining: z.number().optional(),
  type: z.enum(["work", "break"]).optional(),
});
export type PomodoroStatus = z.infer<typeof PomodoroStatusSchema>;

// ── Calendar ───────────────────────────────────────────────────

export const CalendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string(),
  taskId: z.string().optional(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const CalendarEventsSchema = z.object({
  events: z.array(CalendarEventSchema),
});
export type CalendarEvents = z.infer<typeof CalendarEventsSchema>;

// ── Health ─────────────────────────────────────────────────────

export const HealthStatusSchema = z.object({
  status: z.enum(["ok", "error"]),
  version: z.string().optional(),
  uptime: z.number().optional(),
  authenticated: z.boolean().optional(),
});
export type HealthStatus = z.infer<typeof HealthStatusSchema>;
