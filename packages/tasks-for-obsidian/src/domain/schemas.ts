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
  TaskSchema as BaseTaskSchema,
  TaskStatsSchema as BaseTaskStatsSchema,
  NlpParseResultSchema as BaseNlpParseResultSchema,
} from "./base-schemas";

export { TaskStatusSchema } from "./base-schemas";

export const TaskSchema = BaseTaskSchema.transform((raw): Task => ({
  ...raw,
  id: taskId(raw.id),
  contexts: raw.contexts.map((c) => contextName(c)),
  projects: raw.projects.map((p) => projectName(p)),
  tags: raw.tags.map((t) => tagName(t)),
}));

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
  .transform((raw): PomodoroStatus => ({
    ...raw,
    taskId: raw.taskId ? taskId(raw.taskId) : undefined,
  }));

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
