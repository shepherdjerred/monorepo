import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";

import { taskRoutes } from "../routes/tasks.ts";
import { TaskStore } from "../store/task-store.ts";
import { IdempotencyStore } from "../idempotency/store.ts";
import {
  MUTATION_ID_HEADER,
  REPLAY_HEADER,
  idempotencyMiddleware,
} from "../middleware/idempotency.ts";
import { envelopeMiddleware } from "../middleware/envelope.ts";

let tempDir: string;
let app: Hono;
let idempotencyStore: IdempotencyStore;
let storePath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "tasknotes-idem-"));
  const taskStore = new TaskStore(tempDir, "");
  await taskStore.init();
  storePath = path.join(tempDir, ".tasknotes-server", "idempotency.json");
  idempotencyStore = new IdempotencyStore(storePath);
  await idempotencyStore.init();

  // Mirror the production middleware order: envelope, then idempotency.
  app = new Hono();
  app.use("*", envelopeMiddleware);
  app.use("*", idempotencyMiddleware(idempotencyStore));
  app.route("/", taskRoutes(taskStore));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function post(
  url: string,
  body: unknown,
  mutationId?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (mutationId !== undefined) {
    headers[MUTATION_ID_HEADER] = mutationId;
  }
  return app.request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// JSON.parse returns any, which allows property access without type assertions
async function jsonBody(res: Response) {
  return JSON.parse(await res.text());
}

describe("idempotency middleware", () => {
  test("replaying a create with the same mutation id does not create twice", async () => {
    const first = await post("/api/tasks", { title: "Once" }, "mut-1");
    expect(first.status).toBe(201);
    expect(first.headers.get(REPLAY_HEADER)).toBeNull();
    const firstBody = await jsonBody(first);

    const replay = await post("/api/tasks", { title: "Once" }, "mut-1");
    expect(replay.status).toBe(201);
    expect(replay.headers.get(REPLAY_HEADER)).toBe("true");
    const replayBody = await jsonBody(replay);
    expect(replayBody).toEqual(firstBody);

    const list = await app.request("/api/tasks");
    const listBody = await jsonBody(list);
    expect(listBody.data.tasks).toHaveLength(1);
  });

  test("different mutation ids execute independently", async () => {
    await post("/api/tasks", { title: "A" }, "mut-a");
    await post("/api/tasks", { title: "A" }, "mut-b");
    const list = await app.request("/api/tasks");
    const listBody = await jsonBody(list);
    expect(listBody.data.tasks).toHaveLength(2);
  });

  test("requests without the header are never deduplicated", async () => {
    await post("/api/tasks", { title: "A" });
    await post("/api/tasks", { title: "A" });
    const list = await app.request("/api/tasks");
    const listBody = await jsonBody(list);
    expect(listBody.data.tasks).toHaveLength(2);
  });

  test("failed mutations are not stored — retries re-execute", async () => {
    const bad = await post("/api/tasks", { title: 42 }, "mut-fail");
    expect(bad.status).toBe(400);

    const good = await post("/api/tasks", { title: "Fixed" }, "mut-fail");
    expect(good.status).toBe(201);
    expect(good.headers.get(REPLAY_HEADER)).toBeNull();
  });

  test("replayed toggle-style mutations return the original state", async () => {
    const created = await jsonBody(
      await post("/api/tasks", {
        title: "Recurring",
        recurrence: "FREQ=DAILY",
      }),
    );
    const id: string = created.data.id;

    const first = await post(
      `/api/tasks/${id}/complete-instance`,
      { date: "2026-07-03", completed: true },
      "mut-ci",
    );
    const firstBody = await jsonBody(first);
    expect(firstBody.data.completeInstances).toEqual(["2026-07-03"]);

    // A replayed request must not toggle the instance back off.
    const replay = await post(
      `/api/tasks/${id}/complete-instance`,
      { date: "2026-07-03", completed: true },
      "mut-ci",
    );
    expect(replay.headers.get(REPLAY_HEADER)).toBe("true");
    const replayBody = await jsonBody(replay);
    expect(replayBody.data.completeInstances).toEqual(["2026-07-03"]);
  });

  test("GET requests bypass the middleware entirely", async () => {
    const res = await app.request("/api/tasks", {
      headers: { [MUTATION_ID_HEADER]: "mut-get" },
    });
    expect(res.status).toBe(200);
    expect(idempotencyStore.size).toBe(0);
  });

  test("records persist across store restarts (crash safety)", async () => {
    await post("/api/tasks", { title: "Durable" }, "mut-durable");

    const reloaded = new IdempotencyStore(storePath);
    await reloaded.init();
    expect(reloaded.get("mut-durable")).toBeDefined();
    expect(reloaded.get("mut-durable")?.status).toBe(201);
  });
});

describe("IdempotencyStore", () => {
  test("expired records are dropped on read and on load", async () => {
    let now = 1_000_000;
    const clock = () => now;
    const store = new IdempotencyStore(storePath, clock);
    await store.init();
    await store.put({
      id: "old",
      method: "POST",
      path: "/api/tasks",
      status: 201,
      body: "{}",
      ts: now,
    });

    now += 8 * 24 * 60 * 60 * 1000; // past the 7-day TTL
    expect(store.get("old")).toBeUndefined();

    const reloaded = new IdempotencyStore(storePath, clock);
    await reloaded.init();
    expect(reloaded.size).toBe(0);
  });

  test("caps stored records, evicting oldest first", async () => {
    const store = new IdempotencyStore(storePath, () => 1);
    await store.init();
    for (let i = 0; i < 510; i += 1) {
      await store.put({
        id: `mut-${String(i)}`,
        method: "POST",
        path: "/api/tasks",
        status: 201,
        body: "{}",
        // Monotonically increasing ts so eviction order is well-defined.
        ts: i,
      });
    }
    expect(store.size).toBe(500);
    expect(store.get("mut-0")).toBeUndefined();
    expect(store.get("mut-509")).toBeDefined();
  });

  test("malformed state file logs and starts empty instead of crashing", async () => {
    await Bun.write(storePath, "{not json");
    const store = new IdempotencyStore(storePath);
    await store.init();
    expect(store.size).toBe(0);
  });
});
