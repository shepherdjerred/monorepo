import { Hono } from "hono";

import { PomodoroStartSchema } from "../domain/schemas.ts";
import type { PomodoroStore } from "../store/pomodoro-store.ts";

export function pomodoroRoutes(store: PomodoroStore): Hono {
  const app = new Hono();

  app.post("/api/pomodoro/start", async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = PomodoroStartSchema.safeParse(body);
    const taskId = parsed.success ? parsed.data.taskId : undefined;
    const status = store.start(taskId);
    return c.json(status);
  });

  app.post("/api/pomodoro/stop", (c) => {
    const status = store.stop();
    return c.json(status);
  });

  app.post("/api/pomodoro/pause", (c) => {
    const status = store.pause();
    return c.json(status);
  });

  app.get("/api/pomodoro/status", (c) => {
    const status = store.getStatus();
    return c.json(status);
  });

  return app;
}
