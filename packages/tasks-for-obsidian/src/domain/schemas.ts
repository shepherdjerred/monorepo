import { z } from "zod";

import type {
  HealthStatus,
  NlpParseResult,
  PomodoroStatus,
  Task,
  TaskStats,
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
  NlpParseResultSchema as BaseNlpParseResultSchema,
} from "./base-schemas";

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
    extraFields: z.record(z.string(), z.unknown()).default({}),
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

export const TaskStatsSchema = BaseTaskStatsSchema.transform(
  (raw): TaskStats => raw,
);

export const NlpParseResultSchema = BaseNlpParseResultSchema.transform(
  (raw): NlpParseResult => raw,
);

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
