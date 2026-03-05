import { z } from "zod";

import type { Task } from "../domain/types.ts";

const PrioritySchema = z.enum([
  "highest",
  "high",
  "medium",
  "normal",
  "low",
  "none",
]);
const StatusSchema = z.enum([
  "open",
  "in-progress",
  "done",
  "cancelled",
  "waiting",
  "delegated",
]);

const TaskFrontmatterSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: StatusSchema.default("open"),
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
});

export function frontmatterToTask(
  data: Record<string, unknown>,
  body: string,
  filePath: string,
): Task | undefined {
  const parsed = TaskFrontmatterSchema.safeParse(data);
  if (!parsed.success) return undefined;

  const fm = parsed.data;
  return {
    id: fm.id,
    path: filePath,
    title: fm.title,
    status: fm.status,
    priority: fm.priority,
    due: fm.due,
    scheduled: fm.scheduled,
    contexts: fm.contexts,
    projects: fm.projects,
    tags: fm.tags,
    recurrence: fm.recurrence,
    archived: fm.archived,
    totalTrackedTime: fm.totalTrackedTime,
    isBlocked: fm.isBlocked,
    isBlocking: fm.isBlocking,
    details: body || undefined,
  };
}

export function taskToFrontmatter(task: Task): {
  data: Record<string, unknown>;
  content: string;
} {
  const data: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
  };

  if (task.due !== undefined) data["due"] = task.due;
  if (task.scheduled !== undefined) data["scheduled"] = task.scheduled;
  if (task.contexts.length > 0) data["contexts"] = [...task.contexts];
  if (task.projects.length > 0) data["projects"] = [...task.projects];
  if (task.tags.length > 0) data["tags"] = [...task.tags];
  if (task.recurrence !== undefined) data["recurrence"] = task.recurrence;
  if (task.archived) data["archived"] = true;
  if (task.totalTrackedTime > 0)
    data["totalTrackedTime"] = task.totalTrackedTime;
  if (task.isBlocked) data["isBlocked"] = true;
  if (task.isBlocking) data["isBlocking"] = true;

  return { data, content: task.details ?? "" };
}
