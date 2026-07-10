import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { resolveModelConfig } from "tasknotes-types/v2";

import { TaskRepository } from "../engine/task-repository.ts";
import { v2Routes } from "../v2/routes.ts";
import { envelopeMiddleware } from "../middleware/envelope.ts";

const NOW = new Date("2026-07-03T12:00:00.000Z");

let vault: string;
let app: Hono;

const SEEDED = `---
title: Seeded task
status: open
priority: normal
due: 2026-07-01
tags:
  - task
---
Seed body.
`;

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "tn-v2-routes-"));
  await mkdir(path.join(vault, "TaskNotes"), { recursive: true });
  await writeFile(path.join(vault, "TaskNotes/seeded.md"), SEEDED);
  const config = resolveModelConfig();
  const repo = new TaskRepository(vault, "TaskNotes", config, () => NOW);
  await repo.scan();
  app = new Hono();
  app.use("*", envelopeMiddleware);
  app.route(
    "/",
    v2Routes({ repo, config, vaultPath: vault, clock: () => NOW }),
  );
});

const EnvelopeSchema = z.object({
  success: z.boolean(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});

async function envelope(
  response: Response,
): Promise<z.infer<typeof EnvelopeSchema>> {
  return EnvelopeSchema.parse(await response.json());
}

/** Unwrap the { success: true, data } envelope; throws if data is absent. */
async function unwrap(response: Response): Promise<Record<string, unknown>> {
  const body = await envelope(response);
  if (body.data === undefined) throw new Error("expected data in envelope");
  return body.data;
}

function obj(value: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(value);
}

const SEEDED_ID = encodeURIComponent("TaskNotes/seeded.md");

describe("v2 task routes", () => {
  test("GET /api/tasks — pagination defaults, vault info, envelope", async () => {
    const res = await app.request("/api/tasks");
    expect(res.status).toBe(200);
    const body = await envelope(res);
    expect(body.success).toBe(true);
    const page = await unwrap(await app.request("/api/tasks"));
    expect(Array.isArray(page["tasks"])).toBe(true);
    expect(obj(page["pagination"])["limit"]).toBe(50);
    expect(obj(page["vault"])["path"]).toBe(vault);
  });

  test("limit is capped at 200", async () => {
    const page = await unwrap(await app.request("/api/tasks?limit=5000"));
    expect(obj(page["pagination"])["limit"]).toBe(200);
  });

  test("create → 201; get by encoded path id → details from body", async () => {
    const created = await app.request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "From API", due: "2026-07-05" }),
    });
    expect(created.status).toBe(201);
    const task = await unwrap(created);
    expect(task["path"]).toBe("TaskNotes/From API.md");

    const got = await app.request(`/api/tasks/${SEEDED_ID}`);
    expect(got.status).toBe(200);
    const fetched = await unwrap(got);
    expect(fetched["details"]).toBe("Seed body.");
  });

  test("create without title → 400 with error envelope", async () => {
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ due: "2026-07-05" }),
    });
    expect(res.status).toBe(400);
    const body = await envelope(res);
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe("string");
  });

  test("malformed JSON body → 400, not 500", async () => {
    // A SyntaxError from parsing a bad body is a client error. Covers both
    // the manual JSON.parse path (complete-instance) and Hono's c.req.json().
    const completeInstance = await app.request(
      `/api/tasks/${SEEDED_ID}/complete-instance`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not valid json",
      },
    );
    expect(completeInstance.status).toBe(400);
    const ciBody = await envelope(completeInstance);
    expect(ciBody.success).toBe(false);

    const create = await app.request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });
    expect(create.status).toBe(400);
  });

  test("PUT updates; DELETE returns {message}; 404 after", async () => {
    const updated = await app.request(`/api/tasks/${SEEDED_ID}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priority: "high" }),
    });
    expect(updated.status).toBe(200);
    const updatedTask = await unwrap(updated);
    expect(updatedTask["priority"]).toBe("high");

    const deleted = await app.request(`/api/tasks/${SEEDED_ID}`, {
      method: "DELETE",
    });
    const message = await unwrap(deleted);
    expect(message["message"]).toBe("Task deleted successfully");

    const gone = await app.request(`/api/tasks/${SEEDED_ID}`, {
      method: "DELETE",
    });
    expect(gone.status).toBe(404);
  });

  test("query: FilterQuery tree in, unknown operator → 400", async () => {
    const ok = await app.request("/api/tasks/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "group",
        id: "r",
        conjunction: "and",
        children: [
          {
            type: "condition",
            id: "c1",
            property: "status",
            operator: "is",
            value: "open",
          },
        ],
      }),
    });
    expect(ok.status).toBe(200);
    const result = await unwrap(ok);
    expect(result["filtered"]).toBe(1);

    const bad = await app.request("/api/tasks/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "group",
        id: "r",
        conjunction: "and",
        children: [
          {
            type: "condition",
            id: "c1",
            property: "status",
            operator: "resembles",
            value: "open",
          },
        ],
      }),
    });
    expect(bad.status).toBe(400);
  });

  test("toggle-status cycles; complete-instance without recurrence → 400", async () => {
    const toggled = await app.request(`/api/tasks/${SEEDED_ID}/toggle-status`, {
      method: "POST",
    });
    const task = await unwrap(toggled);
    expect(task["status"]).toBe("in-progress");

    const notRecurring = await app.request(
      `/api/tasks/${SEEDED_ID}/complete-instance`,
      { method: "POST" },
    );
    expect(notRecurring.status).toBe(400);
  });

  test("complete-instance rejects a malformed `date` field with 400, not 500", async () => {
    // Schema validation runs before the not-recurring check, so this 400s
    // from CompleteInstanceRequestSchema regardless of the seeded task's
    // recurrence — an invalid date string must never reach `new Date(...)`.
    const res = await app.request(`/api/tasks/${SEEDED_ID}/complete-instance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: "not-a-date" }),
    });
    expect(res.status).toBe(400);
    const body = await envelope(res);
    expect(body.success).toBe(false);
  });

  test("stats + filter-options + time endpoints answer in upstream shapes", async () => {
    const stats = await unwrap(await app.request("/api/stats"));
    expect(stats["total"]).toBe(1);
    expect(stats["overdue"]).toBe(1); // due 07-01 < today 07-03

    const options = await unwrap(await app.request("/api/filter-options"));
    expect(Array.isArray(options["statuses"])).toBe(true);

    const started = await app.request(`/api/tasks/${SEEDED_ID}/time/start`, {
      method: "POST",
    });
    expect(started.status).toBe(200);
    const active = await unwrap(await app.request("/api/time/active"));
    expect(active["totalActiveSessions"]).toBe(1);

    const summary = await unwrap(
      await app.request("/api/time/summary?period=all"),
    );
    expect(summary["period"]).toBe("all");
    // Upstream parity: a session with 0 elapsed minutes doesn't count yet
    // (taskMinutes > 0 gate in upstream timeTrackingUtils).
    expect(obj(summary["summary"])["tasksWithTime"]).toBe(0);
  });
});

describe("v2 NLP + calendars", () => {
  test("nlp/parse returns {parsed, taskData}; nlp/create returns {task, parsed} at 201", async () => {
    const parsedRes = await app.request("/api/nlp/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Buy milk tomorrow !high" }),
    });
    expect(parsedRes.status).toBe(200);
    const parseBody = await unwrap(parsedRes);
    expect(obj(parseBody["parsed"])["title"]).toBe("Buy milk");
    expect(obj(parseBody["taskData"])["title"]).toBe("Buy milk");

    const createdRes = await app.request("/api/nlp/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Water garden today" }),
    });
    expect(createdRes.status).toBe(201);
    const createBody = await unwrap(createdRes);
    expect(obj(createBody["task"])["title"]).toBe("Water garden");
    expect(obj(createBody["parsed"])["title"]).toBe("Water garden");
  });

  test("calendars/events expands recurring tasks and reports sources", async () => {
    await writeFile(
      path.join(vault, "TaskNotes/daily.md"),
      "---\ntitle: Daily standup\nstatus: open\npriority: normal\nscheduled: 2026-07-01\nrecurrence: FREQ=DAILY\ntags: [task]\n---\n",
    );
    const config = resolveModelConfig();
    const repo2 = new TaskRepository(vault, "TaskNotes", config, () => NOW);
    await repo2.scan();
    const app2 = new Hono();
    app2.use("*", envelopeMiddleware);
    app2.route(
      "/",
      v2Routes({ repo: repo2, config, vaultPath: vault, clock: () => NOW }),
    );

    const res = await app2.request(
      "/api/calendars/events?start=2026-07-01&end=2026-07-03",
    );
    expect(res.status).toBe(200);
    const body = await unwrap(res);
    const events = z
      .array(z.looseObject({ id: z.string(), start: z.string() }))
      .parse(body["events"]);
    const dailyEvents = events.filter((e) =>
      e.id.startsWith("TaskNotes/daily"),
    );
    expect(dailyEvents.map((e) => e.start)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
    // The seeded (non-recurring) task appears once on its due date.
    expect(events.some((e) => e.id === "TaskNotes/seeded.md:2026-07-01")).toBe(
      true,
    );
    expect(obj(body["sources"])["tasks"]).toBe(body["total"]);
  });

  test("calendars/events rejects a malformed `start`/`end` query param with 400, not 500", async () => {
    const res = await app.request(
      "/api/calendars/events?start=not-a-date&end=2026-07-03",
    );
    expect(res.status).toBe(400);
    const body = await envelope(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not-a-date");
  });

  test("time/summary rejects a malformed `from`/`to` query param with 400, not 500", async () => {
    const res = await app.request(
      "/api/time/summary?period=custom&from=also-not-a-date",
    );
    expect(res.status).toBe(400);
    const body = await envelope(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain("also-not-a-date");
  });
});

describe("null-as-clear (upstream update convention)", () => {
  test("PUT with due:null removes the due date; file loses the key", async () => {
    const withDue = await app.request(`/api/tasks/${SEEDED_ID}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Renamed", due: null }),
    });
    expect(withDue.status).toBe(200);
    const task = await unwrap(withDue);
    expect(task["title"]).toBe("Renamed");
    expect(task["due"] ?? undefined).toBeUndefined();
    const raw = await Bun.file(path.join(vault, "TaskNotes/seeded.md")).text();
    expect(raw).not.toContain("due:");
  });
});
