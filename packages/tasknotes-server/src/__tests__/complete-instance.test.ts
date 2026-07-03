import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";

import { taskRoutes } from "../routes/tasks.ts";
import { TaskStore } from "../store/task-store.ts";

let tempDir: string;
let app: Hono;
let recurringId: string;

// JSON.parse returns any, which allows property access without type assertions
async function jsonBody(res: Response) {
  return JSON.parse(await res.text());
}

async function post(url: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return app.request(url, init);
}

function localToday(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${String(d.getFullYear())}-${month}-${day}`;
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "tasknotes-ci-"));
  const store = new TaskStore(tempDir, "");
  await store.init();
  app = new Hono();
  app.route("/", taskRoutes(store));

  const created = await post("/api/tasks", {
    title: "Water plants",
    recurrence: "FREQ=DAILY",
  });
  const createdBody = await jsonBody(created);
  recurringId = String(createdBody.id);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("POST /api/tasks/:id/complete-instance", () => {
  test("no body → legacy toggle of server-local today", async () => {
    const first = await jsonBody(
      await post(`/api/tasks/${recurringId}/complete-instance`),
    );
    expect(first.completeInstances).toEqual([localToday()]);

    const second = await jsonBody(
      await post(`/api/tasks/${recurringId}/complete-instance`),
    );
    expect(second.completeInstances).toEqual([]);
  });

  test("explicit date targets that instance instead of today", async () => {
    const result = await jsonBody(
      await post(`/api/tasks/${recurringId}/complete-instance`, {
        date: "2026-06-29",
      }),
    );
    expect(result.completeInstances).toEqual(["2026-06-29"]);
  });

  test("completed: true is SET semantics — repeat calls are idempotent", async () => {
    const body = { date: "2026-07-03", completed: true };
    const first = await jsonBody(
      await post(`/api/tasks/${recurringId}/complete-instance`, body),
    );
    expect(first.completeInstances).toEqual(["2026-07-03"]);

    const second = await jsonBody(
      await post(`/api/tasks/${recurringId}/complete-instance`, body),
    );
    expect(second.completeInstances).toEqual(["2026-07-03"]);
  });

  test("completed: false removes the instance and is idempotent", async () => {
    await post(`/api/tasks/${recurringId}/complete-instance`, {
      date: "2026-07-03",
      completed: true,
    });

    const removed = await jsonBody(
      await post(`/api/tasks/${recurringId}/complete-instance`, {
        date: "2026-07-03",
        completed: false,
      }),
    );
    expect(removed.completeInstances).toEqual([]);

    const again = await jsonBody(
      await post(`/api/tasks/${recurringId}/complete-instance`, {
        date: "2026-07-03",
        completed: false,
      }),
    );
    expect(again.completeInstances).toEqual([]);
  });

  test("invalid date format is a 400", async () => {
    const res = await post(`/api/tasks/${recurringId}/complete-instance`, {
      date: "July 3rd",
    });
    expect(res.status).toBe(400);
  });

  test("unknown body keys are a 400 (strict schema)", async () => {
    const res = await post(`/api/tasks/${recurringId}/complete-instance`, {
      data: "2026-07-03",
    });
    expect(res.status).toBe(400);
  });

  test("malformed JSON body is a 400", async () => {
    const res = await app.request(
      `/api/tasks/${recurringId}/complete-instance`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      },
    );
    expect(res.status).toBe(400);
  });

  test("non-recurring task falls back to status: done (unchanged legacy behavior)", async () => {
    const created = await jsonBody(
      await post("/api/tasks", { title: "One-off" }),
    );
    const result = await jsonBody(
      await post(`/api/tasks/${String(created.id)}/complete-instance`),
    );
    expect(result.status).toBe("done");
  });
});
