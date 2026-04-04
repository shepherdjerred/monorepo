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
import {
  PrioritySchema,
  TaskStatusSchema as _TaskStatusSchema,
  RecurrenceAnchorSchema,
  BlockedByEntrySchema,
  ReminderSchema,
  InlineTimeEntrySchema,
  TaskStatsSchema as BaseTaskStatsSchema,
  FilterOptionsSchema as BaseFilterOptionsSchema,
  NlpParseResultSchema as BaseNlpParseResultSchema,
} from "tasknotes-types";

export const TaskStatusSchema = _TaskStatusSchema;

export const TaskSchema = z
  .object({
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
    extraFields: z.record(z.unknown()).default({}),
    details: z.string().optional(),
  })
  .transform(
    (raw): Task => ({
      ...raw,
      id: taskId(raw.id),
      contexts: raw.contexts.map((c) => contextName(c)),
      projects: raw.projects.map((p) => projectName(p)),
      tags: raw.tags.map((t) => tagName(t)),
    }),
  );

export const TaskListSchema = z.object({
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

// Single task responses: after envelope unwrapping, data IS the task
export const TaskResponseSchema = TaskSchema;
export const CreateTaskResponseSchema = TaskSchema;

export const TaskStatsSchema = BaseTaskStatsSchema.transform(
  (raw): TaskStats => raw,
);

export const FilterOptionsSchema = BaseFilterOptionsSchema.transform(
  (raw): FilterOptions => raw,
);

export const NlpParseResultSchema = BaseNlpParseResultSchema.transform(
  (raw): NlpParseResult => raw,
);

export const TimeEntrySchema = z
  .object({
    taskId: z.string(),
    startTime: z.string(),
    endTime: z.string().optional(),
    duration: z.number().optional(),
  })
  .transform(
    (raw): TimeEntry => ({
      ...raw,
      taskId: taskId(raw.taskId),
    }),
  );

export const TimeSummarySchema = z
  .object({
    totalTime: z.number(),
    entries: z.array(TimeEntrySchema),
  })
  .transform((raw): TimeSummary => raw);

export const PomodoroStatusSchema = z
  .object({
    active: z.boolean(),
    taskId: z.string().optional(),
    timeRemaining: z.number().optional(),
    type: z.enum(["work", "break"]).optional(),
  })
  .transform(
    (raw): PomodoroStatus => ({
      ...raw,
      taskId: raw.taskId ? taskId(raw.taskId) : undefined,
    }),
  );

export const CalendarEventSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    date: z.string(),
    taskId: z.string().optional(),
  })
  .transform(
    (raw): CalendarEvent => ({
      ...raw,
      taskId: raw.taskId ? taskId(raw.taskId) : undefined,
    }),
  );

export const CalendarEventsSchema = z.object({
  events: z.array(CalendarEventSchema),
});

export const HealthStatusSchema = z
  .object({
    status: z.enum(["ok", "error"]),
    version: z.string().optional(),
    uptime: z.number().optional(),
    authenticated: z.boolean().optional(),
  })
  .transform((raw): HealthStatus => raw);

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
