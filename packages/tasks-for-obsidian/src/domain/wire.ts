import { z } from "zod";

import type { Task, TimeSummary, TaskTime } from "./types";
import { contextName, projectName, tagName, taskId } from "./types";
import { PrioritySchema, TaskStatusSchema } from "./base-schemas";

/**
 * The v2 WIRE boundary — the upstream TaskNotes plugin HTTP contract
 * (snake_case recurrence fields, path-as-ID, config-object filter options)
 * parsed and transformed into the app's internal domain shapes. Only this
 * file and the client know the wire spelling; everything inland keeps the
 * camelCase domain `Task` with branded ids and defaulted arrays, which is
 * also why no cache/queue storage migration is needed.
 *
 * Statuses/priorities stay CLOSED enums on purpose: the app's workflow is
 * the vault's post-migration workflow (open/in-progress/done/...). A
 * plugin-side custom status fails validation LOUDLY here instead of being
 * silently remapped.
 */

const WireDependencySchema = z.looseObject({
  uid: z.string(),
  reltype: z.string().optional(),
  gap: z.string().optional(),
});

const WireReminderSchema = z.looseObject({
  id: z.string().optional(),
  type: z.enum(["relative", "absolute"]),
  offset: z.string().optional(),
  relatedTo: z.string().optional(),
  absoluteTime: z.string().optional(),
});

const WireTimeEntrySchema = z.looseObject({
  startTime: z.string(),
  endTime: z.string().optional(),
  duration: z.number().optional(),
});

export const WireTaskSchema = z
  .looseObject({
    id: z.string().optional(),
    path: z.string(),
    title: z.string(),
    status: TaskStatusSchema,
    priority: PrioritySchema,
    due: z.string().optional(),
    scheduled: z.string().optional(),
    contexts: z.array(z.string()).default([]),
    projects: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    recurrence: z.string().optional(),
    recurrence_anchor: z.enum(["scheduled", "completion"]).optional(),
    complete_instances: z.array(z.string()).default([]),
    skipped_instances: z.array(z.string()).default([]),
    completedDate: z.string().optional(),
    dateCreated: z.string().optional(),
    dateModified: z.string().optional(),
    timeEstimate: z.number().optional(),
    timeEntries: z.array(WireTimeEntrySchema).default([]),
    blockedBy: z.array(WireDependencySchema).default([]),
    reminders: z.array(WireReminderSchema).default([]),
    archived: z.boolean().default(false),
    totalTrackedTime: z.number().default(0),
    isBlocked: z.boolean().default(false),
    isBlocking: z.boolean().default(false),
    customProperties: z.record(z.string(), z.unknown()).default({}),
    details: z.string().optional(),
  })
  .transform(
    (raw): Task => ({
      // Path-as-ID (upstream). `id`, when present, equals the path anyway.
      id: taskId(raw.path.length > 0 ? raw.path : (raw.id ?? "")),
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
      recurrenceAnchor: raw.recurrence_anchor,
      completeInstances: raw.complete_instances,
      skippedInstances: raw.skipped_instances,
      completedDate: raw.completedDate,
      dateCreated: raw.dateCreated,
      dateModified: raw.dateModified,
      timeEstimate: raw.timeEstimate,
      timeEntries: raw.timeEntries.map((e) => ({
        startTime: e.startTime,
        ...(e.endTime === undefined ? {} : { endTime: e.endTime }),
        ...(e.duration === undefined ? {} : { duration: e.duration }),
      })),
      blockedBy: raw.blockedBy.map((d) => ({
        uid: d.uid,
        ...(d.reltype === undefined ? {} : { reltype: d.reltype }),
        ...(d.gap === undefined ? {} : { gap: d.gap }),
      })),
      reminders: raw.reminders.map((r) => ({
        type: r.type,
        ...(r.offset === undefined ? {} : { offset: r.offset }),
        ...(r.relatedTo === undefined ? {} : { relatedTo: r.relatedTo }),
        ...(r.absoluteTime === undefined
          ? {}
          : { absoluteTime: r.absoluteTime }),
      })),
      archived: raw.archived,
      totalTrackedTime: raw.totalTrackedTime,
      isBlocked: raw.isBlocked,
      isBlocking: raw.isBlocking,
      extraFields: raw.customProperties,
      details: raw.details,
    }),
  );

/** Domain create/update payloads → v2 wire fields (snake_case). */
export function toWireTaskFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    switch (key) {
      case "recurrenceAnchor":
        out["recurrence_anchor"] = value;
        break;
      case "completeInstances":
        out["complete_instances"] = value;
        break;
      case "skippedInstances":
        out["skipped_instances"] = value;
        break;
      case "extraFields":
        out["customProperties"] = value;
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}

const WireVaultSchema = z.object({
  name: z.string(),
  path: z.string().nullable(),
});

export const WireTaskListSchema = z.object({
  tasks: z.array(WireTaskSchema),
  pagination: z.object({
    total: z.number(),
    offset: z.number(),
    limit: z.number(),
    hasMore: z.boolean(),
  }),
  vault: WireVaultSchema.optional(),
  note: z.string().optional(),
});

export const WireQueryResponseSchema = z.object({
  tasks: z.array(WireTaskSchema),
  total: z.number(),
  filtered: z.number(),
  vault: WireVaultSchema.optional(),
});

/** DELETE /api/tasks/:id → { message } (upstream). */
export const WireDeleteResponseSchema = z.object({ message: z.string() });

/** Config OBJECTS on the wire → the app's plain string lists. */
export const WireFilterOptionsSchema = z
  .looseObject({
    statuses: z.array(z.looseObject({ value: z.string() })),
    priorities: z.array(z.looseObject({ value: z.string() })),
    contexts: z.array(z.string()),
    projects: z.array(z.string()),
    tags: z.array(z.string()),
  })
  .transform((raw) => ({
    statuses: raw.statuses.map((s) => s.value),
    priorities: raw.priorities.map((p) => p.value),
    contexts: raw.contexts,
    projects: raw.projects,
    tags: raw.tags,
  }));

/** GET /api/time/summary → the app's report shape. */
export const WireTimeSummarySchema = z
  .looseObject({
    period: z.string(),
    summary: z.looseObject({ totalMinutes: z.number() }),
    topTasks: z.array(
      z.object({ task: z.string(), title: z.string(), minutes: z.number() }),
    ),
  })
  .transform(
    (raw): TimeSummary => ({
      totalTime: raw.summary.totalMinutes,
      topTasks: raw.topTasks.map((t) => ({
        taskId: taskId(t.task),
        title: t.title,
        minutes: t.minutes,
      })),
    }),
  );

/** GET /api/tasks/:id/time → per-task tracked time. */
export const WireTaskTimeSchema = z
  .looseObject({
    summary: z.looseObject({
      totalMinutes: z.number(),
      activeSessions: z.number(),
    }),
  })
  .transform(
    (raw): TaskTime => ({
      totalTime: raw.summary.totalMinutes,
      hasActiveSession: raw.summary.activeSessions > 0,
    }),
  );

/** POST /api/nlp/parse → { parsed, taskData }; the app wants `parsed`. */
export function wireNlpParseSchema<T extends z.ZodType>(parsed: T) {
  return z
    .object({ parsed: z.unknown() })
    .transform((raw) => raw.parsed)
    .pipe(parsed);
}

/** POST /api/nlp/create → { task, parsed }; the app wants the task. */
export const WireNlpCreateSchema = z
  .object({ task: WireTaskSchema })
  .transform((raw) => raw.task);

/** GET /api/calendars/events (plural, upstream). */
export const WireCalendarEventsSchema = z
  .object({
    events: z.array(
      z.looseObject({
        id: z.string(),
        title: z.string(),
        start: z.string(),
        taskPath: z.string().optional(),
      }),
    ),
  })
  .transform((raw) => ({
    events: raw.events.map((e) => ({
      id: e.id,
      title: e.title,
      date: e.start.slice(0, 10),
      ...(e.taskPath === undefined ? {} : { taskId: taskId(e.taskPath) }),
    })),
  }));
