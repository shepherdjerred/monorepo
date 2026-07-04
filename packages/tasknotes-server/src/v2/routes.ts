import path from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import {
  CompleteInstanceRequestSchema,
  TaskCreationRequestSchema,
  TaskUpdateRequestSchema,
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

function ymd(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
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
      return c.json(task, 201);
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
      return c.json(task);
    }),
  );

  app.delete("/api/tasks/:id", (c) =>
    guard(c, async () => {
      await repo.delete(c.req.param("id"));
      return c.json({ message: "Task deleted successfully" });
    }),
  );

  app.post("/api/tasks/:id/toggle-status", (c) =>
    guard(c, async () => c.json(await repo.toggleStatus(c.req.param("id")))),
  );

  app.post("/api/tasks/:id/archive", (c) =>
    guard(c, async () => c.json(await repo.toggleArchive(c.req.param("id")))),
  );

  app.post("/api/tasks/:id/complete-instance", (c) =>
    guard(c, async () => {
      const raw = await c.req.text();
      const body = CompleteInstanceRequestSchema.parse(
        raw.length === 0 ? {} : JSON.parse(raw),
      );
      const task = await repo.completeInstance(c.req.param("id"), body);
      return c.json(task);
    }),
  );

  app.post("/api/tasks/query", (c) =>
    guard(c, async () => {
      const query = FilterQuerySchema.parse(await c.req.json());
      const tasks = evaluateQuery(query, repo.list(), config);
      return c.json({
        tasks,
        total: repo.list().length,
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
    guard(c, async () => c.json(await repo.startTime(c.req.param("id")))),
  );

  app.post("/api/tasks/:id/time/stop", (c) =>
    guard(c, async () => c.json(await repo.stopTime(c.req.param("id")))),
  );

  app.get("/api/time/active", (c) =>
    c.json(computeActiveSessions(repo.list(), clock())),
  );

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
