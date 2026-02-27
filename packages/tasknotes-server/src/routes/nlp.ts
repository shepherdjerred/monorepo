import { Hono } from "hono";

import { NlpRequestSchema } from "../domain/schemas.ts";
import { parseTaskInput } from "../nlp/parser.ts";
import type { TaskStore } from "../store/task-store.ts";

export function nlpRoutes(store: TaskStore): Hono {
  const app = new Hono();

  app.post("/api/nlp/parse", async (c) => {
    const body: unknown = await c.req.json();
    const parsed = NlpRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400);
    }
    const result = parseTaskInput(parsed.data.text);
    return c.json(result);
  });

  app.post("/api/nlp/create", async (c) => {
    const body: unknown = await c.req.json();
    const parsed = NlpRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400);
    }
    const nlpResult = parseTaskInput(parsed.data.text);
    const task = await store.create({
      title: nlpResult.title,
      due: nlpResult.due,
      priority: nlpResult.priority,
      contexts: nlpResult.contexts,
      projects: nlpResult.projects,
      tags: nlpResult.tags,
      recurrence: nlpResult.recurrence,
    });
    return c.json(task, 201);
  });

  return app;
}
