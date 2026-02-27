import { Hono } from "hono";

import type { TaskStore } from "../store/task-store.ts";

export function calendarRoutes(store: TaskStore): Hono {
  const app = new Hono();

  app.get("/api/calendar/events", (c) => {
    const start = c.req.query("start");
    const end = c.req.query("end");

    const { tasks } = store.getAll(10_000);
    const events = tasks.flatMap((t) => {
      if (t.due === undefined) return [];
      const date = t.due;
      if (start !== undefined && date < start) return [];
      if (end !== undefined && date > end) return [];
      return [{ id: t.id, title: t.title, date, taskId: t.id }];
    });

    return c.json({ events });
  });

  return app;
}
