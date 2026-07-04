import path from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import {
  CompleteInstanceRequestSchema,
  NlpRequestSchema,
  TaskCreationRequestSchema,
  TaskUpdateRequestSchema,
  generateRecurringInstances,
} from "tasknotes-types/v2";
import type { TaskNotesModelConfig } from "tasknotes-types/v2";

import {
  NotRecurringError,
  TaskNotFoundError,
  TimeTrackingError,
  type Clock,
  type TaskRepository,
} from "../engine/task-repository.ts";
import { FilterQuerySchema, evaluateQuery } from "../engine/query.ts";
import { ymd } from "../engine/date.ts";
import { parseTaskInput } from "../nlp/parser.ts";
import { computeFilterOptions, computeStats } from "../engine/stats.ts";
import {
  computeActiveSessions,
  computeTimeSummary,
} from "../engine/time-reports.ts";

/**
 * The v2 route table — the upstream TaskNotes plugin HTTP API, transcribed
 * endpoint-for-endpoint from the upstream controllers, served by the
 * model-backed TaskRepository. The existing envelope middleware wraps every
 * plain JSON response in { success, data } exactly like upstream.
 */

export type V2Dependencies = {
  repo: TaskRepository;
  config: TaskNotesModelConfig;
  vaultPath: string;
  clock?: Clock;
};

function errorStatus(error: unknown): 400 | 404 | 500 {
  if (error instanceof TaskNotFoundError) return 404;
  if (error instanceof NotRecurringError) return 400;
  if (error instanceof TimeTrackingError) return 400;
  if (error instanceof z.ZodError) return 400;
  // A malformed JSON request body (JSON.parse / c.req.json() throws a
  // SyntaxError) is a client error, not a server fault → 400, not 500.
  if (error instanceof SyntaxError) return 400;
  return 500;
}

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

function startOfDay(date: Date): Date {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

function nlpTaskData(parsed: ReturnType<typeof parseTaskInput>): {
  title: string;
  due?: string | undefined;
  priority?: string | undefined;
  projects: string[];
  contexts: string[];
  tags: string[];
} {
  return {
    title: parsed.title,
    due: parsed.due,
    priority: parsed.priority,
    projects: parsed.projects ?? [],
    contexts: parsed.contexts ?? [],
    tags: parsed.tags ?? [],
  };
}

async function guard(
  c: Context,
  body: () => Promise<Response> | Response,
): Promise<Response> {
  try {
    return await body();
  } catch (error) {
    return c.json(
      { success: false, error: errorMessage(error) },
      errorStatus(error),
    );
  }
}

export function v2Routes(deps: V2Dependencies): Hono {
  const { repo, config, vaultPath } = deps;
  const clock = deps.clock ?? (() => new Date());
  const vault = { name: path.basename(vaultPath), path: vaultPath };
  const app = new Hono();

  // Mutation responses carry `details` (the note body) like GET does — the
  // app's offline store merges acked tasks into its base, and a detail-less
  // ack would clobber the visible note text.
  const withDetails = (task: { path: string }): Record<string, unknown> => {
    const entry = repo.get(task.path);
    return { ...task, details: entry === undefined ? "" : entry.body.trim() };
  };

  // -- tasks ---------------------------------------------------------------

  app.get("/api/tasks", (c) => {
    const offsetRaw = Number(c.req.query("offset") ?? "0");
    const limitRaw = Number(c.req.query("limit") ?? "50");
    const offset = Number.isNaN(offsetRaw) || offsetRaw < 0 ? 0 : offsetRaw;
    const limit = Math.min(
      Number.isNaN(limitRaw) || limitRaw < 1 ? 50 : limitRaw,
      200,
    );
    const all = repo.list();
    return c.json({
      tasks: all.slice(offset, offset + limit),
      pagination: {
        total: all.length,
        offset,
        limit,
        hasMore: offset + limit < all.length,
      },
      vault,
      note: "For filtering and advanced queries, use POST /api/tasks/query",
    });
  });

  app.post("/api/tasks", (c) =>
    guard(c, async () => {
      const data = TaskCreationRequestSchema.parse(await c.req.json());
      const task = await repo.create(data);
      return c.json(withDetails(task), 201);
    }),
  );

  app.get("/api/tasks/:id", (c) =>
    guard(c, () => {
      const entry = repo.get(c.req.param("id"));
      if (entry === undefined) {
        return c.json({ success: false, error: "Task not found" }, 404);
      }
      return c.json({ ...entry.task, details: entry.body.trim() });
    }),
  );

  app.put("/api/tasks/:id", (c) =>
    guard(c, async () => {
      const updates = TaskUpdateRequestSchema.parse(await c.req.json());
      const task = await repo.update(c.req.param("id"), updates);
      return c.json(withDetails(task));
    }),
  );

  app.delete("/api/tasks/:id", (c) =>
    guard(c, async () => {
      await repo.delete(c.req.param("id"));
      return c.json({ message: "Task deleted successfully" });
    }),
  );

  app.post("/api/tasks/:id/toggle-status", (c) =>
    guard(c, async () =>
      c.json(withDetails(await repo.toggleStatus(c.req.param("id")))),
    ),
  );

  app.post("/api/tasks/:id/archive", (c) =>
    guard(c, async () =>
      c.json(withDetails(await repo.toggleArchive(c.req.param("id")))),
    ),
  );

  app.post("/api/tasks/:id/complete-instance", (c) =>
    guard(c, async () => {
      const raw = await c.req.text();
      const body = CompleteInstanceRequestSchema.parse(
        raw.length === 0 ? {} : JSON.parse(raw),
      );
      const task = await repo.completeInstance(c.req.param("id"), body);
      return c.json(withDetails(task));
    }),
  );

  app.post("/api/tasks/query", (c) =>
    guard(c, async () => {
      const query = FilterQuerySchema.parse(await c.req.json());
      const all = repo.list();
      const tasks = evaluateQuery(query, all, config);
      return c.json({
        tasks,
        total: all.length,
        filtered: tasks.length,
        vault,
      });
    }),
  );

  app.get("/api/filter-options", (c) =>
    c.json(computeFilterOptions(repo.list(), config)),
  );

  app.get("/api/stats", (c) =>
    c.json(computeStats(repo.list(), config, ymd(clock()))),
  );

  // -- time tracking -------------------------------------------------------

  app.post("/api/tasks/:id/time/start", (c) =>
    guard(c, async () =>
      c.json(withDetails(await repo.startTime(c.req.param("id")))),
    ),
  );

  app.post("/api/tasks/:id/time/stop", (c) =>
    guard(c, async () =>
      c.json(withDetails(await repo.stopTime(c.req.param("id")))),
    ),
  );

  app.get("/api/tasks/:id/time", (c) =>
    guard(c, () => {
      const entry = repo.get(c.req.param("id"));
      if (entry === undefined) {
        return c.json({ success: false, error: "Task not found" }, 404);
      }
      const task = entry.task;
      const entries = task.timeEntries ?? [];
      const now = clock();
      let totalMinutes = 0;
      let completedSessions = 0;
      let activeSessions = 0;
      for (const e of entries) {
        if (e.endTime === undefined) {
          activeSessions += 1;
          totalMinutes += Math.floor(
            (now.getTime() - new Date(e.startTime).getTime()) / 60_000,
          );
        } else {
          completedSessions += 1;
          totalMinutes += Math.floor(
            (new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) /
              60_000,
          );
        }
      }
      return c.json({
        task: {
          id: task.path,
          title: task.title,
          status: task.status,
          priority: task.priority,
        },
        summary: {
          totalMinutes,
          totalHours: Math.round((totalMinutes / 60) * 100) / 100,
          totalSessions: entries.length,
          completedSessions,
          activeSessions,
        },
      });
    }),
  );

  app.get("/api/time/active", (c) =>
    c.json(computeActiveSessions(repo.list(), clock())),
  );

  // -- NLP -------------------------------------------------------------------

  app.post("/api/nlp/parse", (c) =>
    guard(c, async () => {
      const { text } = NlpRequestSchema.parse(await c.req.json());
      const parsed = parseTaskInput(text);
      return c.json({ parsed, taskData: nlpTaskData(parsed) });
    }),
  );

  app.post("/api/nlp/create", (c) =>
    guard(c, async () => {
      const { text } = NlpRequestSchema.parse(await c.req.json());
      const parsed = parseTaskInput(text);
      const task = await repo.create(nlpTaskData(parsed));
      return c.json({ task, parsed }, 201);
    }),
  );

  // -- calendars ---------------------------------------------------------------

  // Task-derived events only: due/scheduled dates plus recurring expansion
  // via the model's rrule engine. `sources` reports where events came from.
  app.get("/api/calendars/events", (c) => {
    const startParam = c.req.query("start");
    const endParam = c.req.query("end");
    const now = clock();
    const start =
      startParam === undefined ? startOfDay(now) : new Date(startParam);
    const end =
      endParam === undefined
        ? addDays(startOfDay(now), 30)
        : new Date(endParam);

    const events: {
      id: string;
      title: string;
      start: string;
      allDay: boolean;
      taskPath: string;
    }[] = [];
    for (const task of repo.list()) {
      if (task.recurrence !== undefined && task.recurrence.length > 0) {
        for (const date of generateRecurringInstances(task, start, end)) {
          const day = ymd(date);
          events.push({
            id: `${task.path}:${day}`,
            title: task.title,
            start: day,
            allDay: true,
            taskPath: task.path,
          });
        }
        continue;
      }
      const anchor = task.due ?? task.scheduled;
      if (anchor === undefined) continue;
      const day = anchor.slice(0, 10);
      if (day < ymd(start) || day > ymd(end)) continue;
      events.push({
        id: `${task.path}:${day}`,
        title: task.title,
        start: day,
        allDay: true,
        taskPath: task.path,
      });
    }
    return c.json({
      events,
      total: events.length,
      sources: { tasks: events.length },
    });
  });

  app.get("/api/time/summary", (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    return c.json(
      computeTimeSummary(
        repo.list(),
        {
          period: c.req.query("period") ?? "today",
          fromDate: from === undefined ? undefined : new Date(from),
          toDate: to === undefined ? undefined : new Date(to),
        },
        config,
        clock(),
      ),
    );
  });

  return app;
}
