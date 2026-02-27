import { Hono } from "hono";

import type { TimeStore } from "../store/time-store.ts";

export function timeRoutes(store: TimeStore): Hono {
  const app = new Hono();

  app.post("/api/time/:id/start", async (c) => {
    const id = c.req.param("id");
    await store.startTracking(id);
    return c.json({ success: true });
  });

  app.post("/api/time/:id/stop", async (c) => {
    const id = c.req.param("id");
    await store.stopTracking(id);
    return c.json({ success: true });
  });

  app.get("/api/time/:id", (c) => {
    const id = c.req.param("id");
    const summary = store.getTaskEntries(id);
    return c.json(summary);
  });

  app.get("/api/time/summary", (c) => {
    const summary = store.getSummary();
    return c.json(summary);
  });

  return app;
}
