import { z } from "zod";

export const PrioritySchema = z.enum([
  "highest",
  "high",
  "medium",
  "normal",
  "low",
  "none",
]);

export const TaskStatusSchema = z.enum([
  "open",
  "in-progress",
  "done",
  "cancelled",
  "waiting",
  "delegated",
]);

export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: TaskStatusSchema.optional(),
  priority: PrioritySchema.optional(),
  due: z.string().optional(),
  scheduled: z.string().optional(),
  contexts: z.array(z.string()).optional(),
  projects: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  recurrence: z.string().optional(),
  timeEstimate: z.number().optional(),
});

export const UpdateTaskRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: TaskStatusSchema.optional(),
  priority: PrioritySchema.optional(),
  due: z.string().nullable().optional(),
  scheduled: z.string().nullable().optional(),
  contexts: z.array(z.string()).optional(),
  projects: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  recurrence: z.string().nullable().optional(),
  timeEstimate: z.number().nullable().optional(),
});

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

export const NlpRequestSchema = z.object({
  text: z.string().min(1),
});

export const PomodoroStartSchema = z.object({
  taskId: z.string().optional(),
});
