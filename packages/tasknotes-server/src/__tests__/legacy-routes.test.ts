import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";

import { TaskSchema } from "tasknotes-types";
import { resolveModelConfig } from "tasknotes-types/v2";
import { TaskRepository } from "../engine/task-repository.ts";
import { legacyRoutes } from "../legacy/routes.ts";
import { envelopeMiddleware } from "../middleware/envelope.ts";

/**
 * The oracle here is the LEGACY TaskSchema — the exact zod schema the P2
 * app parses responses with. If the adapter's output fails it, the app
 * would error in production.
 */

const NOW = new Date("2026-07-03T12:00:00.000Z");

let vault: string;
let app: Hono;

const SEEDED = `---
title: Seeded task
status: open
priority: normal
due: 2026-07-01
recurrence: FREQ=DAILY
tags:
  - task
---
Body.
`;

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "tn-legacy-"));
  await mkdir(path.join(vault, "TaskNotes"), { recursive: true });
  await writeFile(path.join(vault, "TaskNotes/seeded.md"), SEEDED);
  const config = resolveModelConfig();
  const repo = new TaskRepository(vault, "TaskNotes", config, () => NOW);
  await repo.scan();
  app = new Hono();
  app.use("*", envelopeMiddleware);
  app.route("/", legacyRoutes({ repo, config, clock: () => NOW }));
});

const DataEnvelope = z.object({ success: z.literal(true), data: z.unknown() });

async function unwrap(response: Response): Promise<unknown> {
  return DataEnvelope.parse(await response.json()).data;
}

describe("legacy adapter — P2 app contract", () => {
  test("list tasks parse with the app's legacy TaskSchema", async () => {
    const res = await app.request("/api/tasks?limit=1000");
    expect(res.status).toBe(200);
    const data = z
      .object({ tasks: z.array(z.unknown()) })
      .loose()
      .parse(await unwrap(res));
    expect(data.tasks).toHaveLength(1);
    const task = TaskSchema.parse(data.tasks[0]);
    expect(task.id).toBe("TaskNotes/seeded.md");
    expect(task.completeInstances).toEqual([]);
    expect(task.details).toBe("Body.");
  });

  test("create with camelCase fields lands in snake_case frontmatter", async () => {
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Legacy create",
        recurrence: "FREQ=WEEKLY",
        recurrenceAnchor: "scheduled",
        due: "2026-07-08",
      }),
    });
    expect(res.status).toBe(201);
    const task = TaskSchema.parse(await unwrap(res));
    expect(task.recurrenceAnchor).toBe("scheduled");
    const raw = await Bun.file(
      path.join(vault, "TaskNotes/Legacy create.md"),
    ).text();
    expect(raw).toContain("recurrence_anchor: scheduled");
  });

  test("toggle-status applies the app's absolute status", async () => {
    const id = encodeURIComponent("TaskNotes/seeded.md");
    const res = await app.request(`/api/tasks/${id}/toggle-status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    const task = TaskSchema.parse(await unwrap(res));
    expect(task.status).toBe("done");
  });

  test("complete-instance {date, completed} keeps P1 set-semantics", async () => {
    const id = encodeURIComponent("TaskNotes/seeded.md");
    const body = JSON.stringify({ date: "2026-07-01", completed: true });
    const first = TaskSchema.parse(
      await unwrap(
        await app.request(`/api/tasks/${id}/complete-instance`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      ),
    );
    expect(first.completeInstances).toEqual(["2026-07-01"]);
    const replay = TaskSchema.parse(
      await unwrap(
        await app.request(`/api/tasks/${id}/complete-instance`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      ),
    );
    expect(replay.completeInstances).toEqual(["2026-07-01"]);
  });

  test("delete/archive return the legacy {success} shape", async () => {
    const id = encodeURIComponent("TaskNotes/seeded.md");
    // {success:true} carries no data: the envelope middleware passes it
    // through raw, and the app parses the raw body (its envelope schema
    // requires `data`, so it falls back) — exactly the old server's shape.
    const archived = await app.request(`/api/tasks/${id}/archive`, {
      method: "POST",
    });
    expect(await archived.json()).toEqual({ success: true });
    const deleted = await app.request(`/api/tasks/${id}`, {
      method: "DELETE",
    });
    expect(await deleted.json()).toEqual({ success: true });
  });

  test("filter-options returns bare string lists (legacy shape)", async () => {
    const res = await app.request("/api/filter-options");
    const options = z
      .object({
        statuses: z.array(z.string()),
        priorities: z.array(z.string()),
        tags: z.array(z.string()),
      })
      .loose()
      .parse(await unwrap(res));
    expect(options.statuses).toContain("open");
    expect(options.tags).toEqual(["task"]);
  });

  test("legacy time paths work against frontmatter entries", async () => {
    const id = encodeURIComponent("TaskNotes/seeded.md");
    const started = await app.request(`/api/time/${id}/start`, {
      method: "POST",
    });
    expect(await started.json()).toEqual({ success: true });
    const summary = z
      .object({ totalTime: z.number(), entries: z.array(z.unknown()) })
      .parse(await unwrap(await app.request("/api/time/summary")));
    expect(summary.entries).toHaveLength(1);
  });
});
