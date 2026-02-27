import { Hono } from "hono";

import {
  CreateTaskRequestSchema,
  TaskQueryFilterSchema,
  UpdateTaskRequestSchema,
} from "../domain/schemas.ts";
import type { TaskStore } from "../store/task-store.ts";

export function taskRoutes(store: TaskStore): Hono {
  const app = new Hono();

  app.get("/api/tasks", (c) => {
    const limit = Number(c.req.query("limit") ?? "1000");
    const offset = Number(c.req.query("offset") ?? "0");
    const { tasks, total } = store.getAll(limit, offset);
    return c.json({
      tasks,
      pagination: {
        total,
        offset,
        limit,
        hasMore: offset + limit < total,
      },
    });
  });

  app.get("/api/tasks/filters", (c) => {
    return c.json(store.getFilterOptions());
  });

  app.get("/api/tasks/stats", (c) => {
    return c.json(store.getStats());
  });

  app.post("/api/tasks/query", async (c) => {
    const body: unknown = await c.req.json();
    const parsed = TaskQueryFilterSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400);
    }
    const result = store.query(parsed.data);
    return c.json(result);
  });

  app.get("/api/tasks/:id", (c) => {
    const id = c.req.param("id");
    const task = store.getById(id);
    if (task === undefined) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }
    return c.json(task);
  });

  app.post("/api/tasks", async (c) => {
    const body: unknown = await c.req.json();
    const parsed = CreateTaskRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400);
    }
    const task = await store.create(parsed.data);
    return c.json(task, 201);
  });

  app.put("/api/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const body: unknown = await c.req.json();
    const parsed = UpdateTaskRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400);
    }
    const task = await store.update(id, parsed.data);
    if (task === undefined) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }
    return c.json(task);
  });

  app.delete("/api/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const deleted = await store.delete(id);
    if (!deleted) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }
    return c.json({ success: true });
  });

  app.post("/api/tasks/:id/status", async (c) => {
    const id = c.req.param("id");
    const body: unknown = await c.req.json();
    const parsed = UpdateTaskRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400);
    }
    const task = await store.update(id, parsed.data);
    if (task === undefined) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }
    return c.json(task);
  });

  app.post("/api/tasks/:id/archive", async (c) => {
    const id = c.req.param("id");
    const archived = await store.archive(id);
    if (!archived) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }
    return c.json({ success: true });
  });

  app.post("/api/tasks/:id/complete-recurring", async (c) => {
    const id = c.req.param("id");
    const task = await store.completeRecurring(id);
    if (task === undefined) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }
    return c.json(task);
  });

  return app;
}
