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
const RecurrenceAnchorSchema = z.enum(["scheduled", "completion"]);

const BlockedByEntrySchema = z.object({
  uid: z.string(),
  reltype: z.string().optional(),
  gap: z.string().optional(),
});

const ReminderSchema = z.object({
  type: z.enum(["relative", "absolute"]),
  offset: z.string().optional(),
  relatedTo: z.string().optional(),
  absoluteTime: z.string().optional(),
});

const InlineTimeEntrySchema = z.object({
  startTime: z.string(),
  endTime: z.string().optional(),
  duration: z.number().optional(),
});

function deriveIdFromPath(filePath: string): string {
  const withoutExt = filePath.replace(/\.md$/i, "");
  return withoutExt
    .toLowerCase()
    .replaceAll(/[^a-z0-9/]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .replaceAll("/", "-");
}

// All known frontmatter keys (snake_case as they appear in YAML).
// Anything not in this set goes into extraFields.
const KNOWN_FRONTMATTER_KEYS = new Set([
  "id",
  "title",
  "status",
  "priority",
  "due",
  "scheduled",
  "contexts",
  "projects",
  "tags",
  "recurrence",
  "recurrence_anchor",
  "complete_instances",
  "skipped_instances",
  "completedDate",
  "dateCreated",
  "dateModified",
  "timeEstimate",
  "timeEntries",
  "blockedBy",
  "reminders",
  "archived",
  "totalTrackedTime",
  "isBlocked",
  "isBlocking",
  "googleCalendarEventId",
  "icsEventId",
]);

const TaskFrontmatterSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  status: StatusSchema.default("open"),
  priority: PrioritySchema.default("normal"),
  due: z.string().optional(),
  scheduled: z.string().optional(),
  contexts: z.array(z.string()).default([]),
  projects: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  recurrence: z.string().optional(),
  recurrence_anchor: RecurrenceAnchorSchema.optional(),
  complete_instances: z.array(z.string()).default([]),
  skipped_instances: z.array(z.string()).default([]),
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
});

export function frontmatterToTask(
  data: Record<string, unknown>,
  body: string,
  filePath: string,
): Task | undefined {
  const parsed = TaskFrontmatterSchema.safeParse(data);
  if (!parsed.success) return undefined;

  // Collect unknown keys into extraFields
  const extraFields: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (!KNOWN_FRONTMATTER_KEYS.has(key)) {
      extraFields[key] = data[key];
    }
  }

  const fm = parsed.data;
  return {
    id: fm.id ?? deriveIdFromPath(filePath),
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
    recurrenceAnchor: fm.recurrence_anchor,
    completeInstances: fm.complete_instances,
    skippedInstances: fm.skipped_instances,
    completedDate: fm.completedDate,
    dateCreated: fm.dateCreated,
    dateModified: fm.dateModified,
    timeEstimate: fm.timeEstimate,
    timeEntries: fm.timeEntries,
    blockedBy: fm.blockedBy,
    reminders: fm.reminders,
    archived: fm.archived,
    totalTrackedTime: fm.totalTrackedTime,
    isBlocked: fm.isBlocked,
    isBlocking: fm.isBlocking,
    googleCalendarEventId: fm.googleCalendarEventId,
    icsEventId: fm.icsEventId,
    extraFields,
    details: body || undefined,
  };
}

function setIfDefined(
  data: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== undefined) data[key] = value;
}

function setIfNonEmpty(
  data: Record<string, unknown>,
  key: string,
  arr: readonly unknown[],
): void {
  if (arr.length > 0) data[key] = [...arr];
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

  setIfDefined(data, "due", task.due);
  setIfDefined(data, "scheduled", task.scheduled);
  setIfNonEmpty(data, "contexts", task.contexts);
  setIfNonEmpty(data, "projects", task.projects);
  setIfNonEmpty(data, "tags", task.tags);
  setIfDefined(data, "recurrence", task.recurrence);
  setIfDefined(data, "recurrence_anchor", task.recurrenceAnchor);
  setIfNonEmpty(data, "complete_instances", task.completeInstances);
  setIfNonEmpty(data, "skipped_instances", task.skippedInstances);
  setIfDefined(data, "completedDate", task.completedDate);
  setIfDefined(data, "dateCreated", task.dateCreated);
  setIfDefined(data, "dateModified", task.dateModified);
  setIfDefined(data, "timeEstimate", task.timeEstimate);
  setIfNonEmpty(data, "timeEntries", task.timeEntries);
  setIfNonEmpty(data, "blockedBy", task.blockedBy);
  setIfNonEmpty(data, "reminders", task.reminders);
  if (task.archived) data["archived"] = true;
  if (task.totalTrackedTime > 0)
    data["totalTrackedTime"] = task.totalTrackedTime;
  if (task.isBlocked) data["isBlocked"] = true;
  if (task.isBlocking) data["isBlocking"] = true;
  setIfDefined(data, "googleCalendarEventId", task.googleCalendarEventId);
  setIfDefined(data, "icsEventId", task.icsEventId);

  // Preserve user-defined custom fields
  for (const [key, value] of Object.entries(task.extraFields)) {
    data[key] = value;
  }

  return { data, content: task.details ?? "" };
}
