import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { TaskInfo, TaskNotesModelConfig } from "tasknotes-types/v2";

import {
  CompleteInstanceRequestSchema,
  CreateTaskRequestSchema,
  NlpRequestSchema,
  TaskQueryFilterSchema,
  UpdateTaskRequestSchema,
} from "../domain/schemas.ts";
import {
  NotRecurringError,
  TaskNotFoundError,
  TimeTrackingError,
  type Clock,
  type TaskRepository,
} from "../engine/task-repository.ts";
import { computeStats } from "../engine/stats.ts";
import { parseTaskInput } from "../nlp/parser.ts";

/**
 * Legacy adapter: the OLD camelCase contract (which the P2 app speaks)
 * translated onto the model-backed TaskRepository, so the app keeps working
 * between the P3 server deploy and the P5 app migration. Deleted at P6.
 *
 * Task IDs over this surface are vault-relative paths — the app treats ids
 * as opaque and URL-encodes them, so the id-scheme change is invisible to
 * it (its old 8-char ids die with the P4 vault migration's quiet window).
 */

const LEGACY_STATUSES = new Set([
  "open",
  "in-progress",
  "done",
  "cancelled",
  "waiting",
  "delegated",
]);

const LEGACY_PRIORITIES = new Set([
  "highest",
  "high",
  "medium",
  "normal",
  "low",
  "none",
]);

/** TaskInfo (snake_case, config-driven) → legacy camelCase wire shape. */
export function toLegacyTask(
  task: TaskInfo,
  details: string,
): Record<string, unknown> {
  return {
    id: task.path,
    path: task.path,
    title: task.title,
    // The default workflow's "none" status predates the legacy enum; the
    // nearest legacy meaning is "open" (lossy display-only mapping).
    status: LEGACY_STATUSES.has(task.status) ? task.status : "open",
    priority: LEGACY_PRIORITIES.has(task.priority) ? task.priority : "normal",
    due: task.due,
    scheduled: task.scheduled,
    contexts: task.contexts ?? [],
    projects: task.projects ?? [],
    tags: task.tags ?? [],
    recurrence: task.recurrence,
    recurrenceAnchor: task.recurrence_anchor,
    completeInstances: task.complete_instances ?? [],
    skippedInstances: task.skipped_instances ?? [],
    completedDate: task.completedDate,
    dateCreated: task.dateCreated,
    dateModified: task.dateModified,
    timeEstimate: task.timeEstimate,
    timeEntries: task.timeEntries ?? [],
    blockedBy: [],
    reminders: task.reminders ?? [],
    archived: task.archived,
    totalTrackedTime: task.totalTrackedTime ?? 0,
    isBlocked: task.isBlocked ?? false,
    isBlocking: task.isBlocking ?? false,
    extraFields: task.customProperties ?? {},
    details,
  };
}

/** Legacy camelCase request fields → v2/model snake_case updates. */
function toV2Fields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
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

function errorStatus(error: unknown): 400 | 404 | 500 {
  if (error instanceof TaskNotFoundError) return 404;
  if (error instanceof NotRecurringError) return 400;
  if (error instanceof TimeTrackingError) return 400;
  if (error instanceof z.ZodError) return 400;
  return 500;
}

async function guard(
  c: Context,
  body: () => Promise<Response> | Response,
): Promise<Response> {
  try {
    return await body();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, errorStatus(error));
  }
}

export type LegacyDependencies = {
  repo: TaskRepository;
  config: TaskNotesModelConfig;
  clock?: Clock;
};

export function legacyRoutes(deps: LegacyDependencies): Hono {
  const { repo, config } = deps;
  const clock = deps.clock ?? (() => new Date());
  const app = new Hono();

  const legacy = (task: TaskInfo): Record<string, unknown> => {
    const entry = repo.get(task.path);
    return toLegacyTask(task, entry === undefined ? "" : entry.body.trim());
  };

  app.get("/api/tasks", (c) => {
    const limit = Number(c.req.query("limit") ?? "1000");
    const offset = Number(c.req.query("offset") ?? "0");
    const all = repo.list();
    return c.json({
      tasks: all.slice(offset, offset + limit).map((t) => legacy(t)),
      pagination: {
        total: all.length,
        offset,
        limit,
        hasMore: offset + limit < all.length,
      },
    });
  });

  app.post("/api/tasks", (c) =>
    guard(c, async () => {
      const body = CreateTaskRequestSchema.parse(await c.req.json());
      const task = await repo.create(
        z.looseObject({ title: z.string().min(1) }).parse(toV2Fields(body)),
      );
      return c.json(legacy(task), 201);
    }),
  );

  app.get("/api/tasks/:id", (c) =>
    guard(c, () => {
      const entry = repo.get(c.req.param("id"));
      if (entry === undefined) {
        return c.json({ success: false, error: "Task not found" }, 404);
      }
      return c.json(legacy(entry.task));
    }),
  );

  app.put("/api/tasks/:id", (c) =>
    guard(c, async () => {
      const body = UpdateTaskRequestSchema.parse(await c.req.json());
      const task = await repo.update(c.req.param("id"), toV2Fields(body));
      return c.json(legacy(task));
    }),
  );

  app.delete("/api/tasks/:id", (c) =>
    guard(c, async () => {
      await repo.delete(c.req.param("id"));
      return c.json({ success: true });
    }),
  );

  // Legacy semantics: the app SENDS the absolute target status.
  app.post("/api/tasks/:id/toggle-status", (c) =>
    guard(c, async () => {
      const { status } = z
        .object({ status: z.string() })
        .parse(await c.req.json());
      const task = await repo.update(c.req.param("id"), { status });
      return c.json(legacy(task));
    }),
  );

  app.post("/api/tasks/:id/archive", (c) =>
    guard(c, async () => {
      await repo.toggleArchive(c.req.param("id"));
      return c.json({ success: true });
    }),
  );

  app.post("/api/tasks/:id/complete-instance", (c) =>
    guard(c, async () => {
      const raw = await c.req.text();
      const body = CompleteInstanceRequestSchema.parse(
        raw.length === 0 ? {} : JSON.parse(raw),
      );
      const task = await repo.completeInstance(c.req.param("id"), body);
      return c.json(legacy(task));
    }),
  );

  // Legacy flat filter (not the upstream FilterQuery tree).
  app.post("/api/tasks/query", (c) =>
    guard(c, async () => {
      const filter = TaskQueryFilterSchema.parse(await c.req.json());
      const matches = repo
        .list()
        .filter((task) => matchesLegacyFilter(task, filter));
      return c.json({
        tasks: matches.map((t) => legacy(t)),
        total: matches.length,
      });
    }),
  );

  // Legacy shape: bare string lists (v2 returns config objects).
  app.get("/api/filter-options", (c) => {
    const tasks = repo.list();
    const collect = (pick: (t: TaskInfo) => readonly string[]): string[] =>
      [...new Set(tasks.flatMap((t) => [...pick(t)]))].sort();
    return c.json({
      statuses: config.statuses.map((s) => s.value),
      priorities: config.priorities.map((p) => p.value),
      contexts: collect((t) => t.contexts ?? []),
      projects: collect((t) => t.projects ?? []),
      tags: collect((t) => t.tags ?? []),
    });
  });

  app.get("/api/stats", (c) =>
    c.json(computeStats(repo.list(), config, ymd(clock()))),
  );

  // -- NLP (legacy flat shapes) ---------------------------------------------

  app.post("/api/nlp/parse", (c) =>
    guard(c, async () => {
      const { text } = NlpRequestSchema.parse(await c.req.json());
      return c.json(parseTaskInput(text));
    }),
  );

  app.post("/api/nlp/create", (c) =>
    guard(c, async () => {
      const { text } = NlpRequestSchema.parse(await c.req.json());
      const parsed = parseTaskInput(text);
      const task = await repo.create({
        title: parsed.title,
        due: parsed.due,
        priority: parsed.priority,
        projects: parsed.projects ?? [],
        contexts: parsed.contexts ?? [],
        tags: parsed.tags ?? [],
      });
      return c.json(legacy(task), 201);
    }),
  );

  // -- time (legacy /api/time/:id paths and {totalTime, entries} shape) -----

  app.post("/api/time/:id/start", (c) =>
    guard(c, async () => {
      await repo.startTime(c.req.param("id"));
      return c.json({ success: true });
    }),
  );

  app.post("/api/time/:id/stop", (c) =>
    guard(c, async () => {
      await repo.stopTime(c.req.param("id"));
      return c.json({ success: true });
    }),
  );

  app.get("/api/time/summary", (c) => {
    const entries = repo.list().flatMap((task) =>
      (task.timeEntries ?? []).map((entry) => ({
        taskId: task.path,
        startTime: entry.startTime,
        endTime: entry.endTime,
        duration: entryMinutes(entry, clock()),
      })),
    );
    return c.json({
      totalTime: entries.reduce((sum, e) => sum + e.duration, 0),
      entries,
    });
  });

  app.get("/api/time/:id", (c) =>
    guard(c, () => {
      const entry = repo.get(c.req.param("id"));
      if (entry === undefined) {
        return c.json({ success: false, error: "Task not found" }, 404);
      }
      const entries = (entry.task.timeEntries ?? []).map((e) => ({
        taskId: entry.task.path,
        startTime: e.startTime,
        endTime: e.endTime,
        duration: entryMinutes(e, clock()),
      }));
      return c.json({
        totalTime: entries.reduce((sum, e) => sum + e.duration, 0),
        entries,
      });
    }),
  );

  // -- calendar (legacy singular path + {events:[{id,title,date,taskId}]}) --

  app.get("/api/calendar/events", (c) => {
    const start = c.req.query("start");
    const end = c.req.query("end");
    const events = repo.list().flatMap((task) => {
      if (task.due === undefined) return [];
      const date = task.due.slice(0, 10);
      if (start !== undefined && date < start) return [];
      if (end !== undefined && date > end) return [];
      return [{ id: task.path, title: task.title, date, taskId: task.path }];
    });
    return c.json({ events });
  });

  return app;
}

type LegacyFilter = z.infer<typeof TaskQueryFilterSchema>;

function anyOverlap(
  wanted: readonly string[] | undefined,
  actual: readonly string[],
): boolean {
  return wanted === undefined || wanted.some((w) => actual.includes(w));
}

function matchesDates(task: TaskInfo, filter: LegacyFilter): boolean {
  const due = task.due?.slice(0, 10);
  if (
    filter.dueBefore !== undefined &&
    (due === undefined || due >= filter.dueBefore)
  ) {
    return false;
  }
  if (
    filter.dueAfter !== undefined &&
    (due === undefined || due <= filter.dueAfter)
  ) {
    return false;
  }
  if (filter.hasNoDueDate === true && due !== undefined) return false;
  return true;
}

function matchesLegacyFilter(task: TaskInfo, filter: LegacyFilter): boolean {
  const statuses: readonly string[] = filter.status ?? [];
  if (filter.status !== undefined && !statuses.includes(task.status)) {
    return false;
  }
  const priorities: readonly string[] = filter.priority ?? [];
  if (filter.priority !== undefined && !priorities.includes(task.priority)) {
    return false;
  }
  if (!anyOverlap(filter.projects, task.projects ?? [])) return false;
  if (!anyOverlap(filter.contexts, task.contexts ?? [])) return false;
  if (!anyOverlap(filter.tags, task.tags ?? [])) return false;
  if (!matchesDates(task, filter)) return false;
  if (filter.hasNoProject === true && (task.projects ?? []).length > 0) {
    return false;
  }
  if (
    filter.search !== undefined &&
    !task.title.toLowerCase().includes(filter.search.toLowerCase())
  ) {
    return false;
  }
  return true;
}

function entryMinutes(
  entry: { startTime: string; endTime?: string | undefined },
  now: Date,
): number {
  const start = new Date(entry.startTime).getTime();
  const end =
    entry.endTime === undefined
      ? now.getTime()
      : new Date(entry.endTime).getTime();
  return Math.max(0, Math.floor((end - start) / 60_000));
}

function ymd(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
}
