import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TaskNotesClient } from "../src/data/api/TaskNotesClient";
import { localTodayYmd } from "../src/domain/recurrence";
import { taskId, type Task } from "../src/domain/types";

/**
 * Contract test: the app's real TaskNotesClient against the real
 * tasknotes-server (spawned as a separate bun process over a temp vault).
 *
 * This pins the wire contract the two packages currently share. When the
 * server is rebuilt (plan P3), this suite is what keeps the legacy adapter
 * honest until the app migrates (P5).
 *
 * Runs via `bun run test:contract` (not part of the default `bun test src
 * scripts` — it needs the sibling package present and spawns a server).
 */

const AUTH_TOKEN = "contract-test-token";
const PORT = 18_700 + (process.pid % 200);
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

const serverDir = fileURLToPath(
  new URL("../../tasknotes-server", import.meta.url),
);

let vaultDir: string;
let serverProc: ReturnType<typeof Bun.spawn>;
// Drained continuously from spawn time. Reading `serverProc.stderr` only
// resolves once the process closes its stderr fd (i.e. after it exits), so a
// server that starts listening but is slow to answer would deadlock the
// timeout path below. Buffer chunks in the background instead and read the
// accumulated text synchronously when we give up.
let serverStderr = "";

function drainStderr(stream: ReadableStream<Uint8Array>): void {
  const decoder = new TextDecoder();
  void (async () => {
    for await (const chunk of stream) {
      serverStderr += decoder.decode(chunk, { stream: true });
    }
    serverStderr += decoder.decode();
  })();
}

const client = new TaskNotesClient({
  baseUrl: BASE_URL,
  authToken: AUTH_TOKEN,
});

async function waitForHealthy(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.health();
    if (result.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `tasknotes-server did not become healthy on ${BASE_URL}.\nstderr:\n${serverStderr}`,
  );
}

beforeAll(async () => {
  if (!existsSync(path.join(serverDir, "package.json"))) {
    throw new Error(
      `Expected sibling package at ${serverDir} — the contract test must run inside the monorepo.`,
    );
  }
  vaultDir = await mkdtemp(path.join(tmpdir(), "tasknotes-contract-"));
  await mkdir(path.join(vaultDir, "TaskNotes"), { recursive: true });
  serverProc = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: serverDir,
    env: {
      ...process.env,
      VAULT_PATH: vaultDir,
      TASKS_DIR: "TaskNotes",
      AUTH_TOKEN,
      PORT: String(PORT),
      SENTRY_ENABLED: "false",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (serverProc.stderr instanceof ReadableStream) {
    drainStderr(serverProc.stderr);
  }
  await waitForHealthy();
});

afterAll(async () => {
  serverProc.kill();
  await serverProc.exited;
  await rm(vaultDir, { recursive: true, force: true });
});

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!result.ok) {
    throw new Error(
      `Expected ok result, got error: ${JSON.stringify(result.error)}`,
    );
  }
  return result.value;
}

describe("health & auth", () => {
  test("health reports ok and authenticated", async () => {
    const health = unwrap(await client.health());
    expect(health.status).toBe("ok");
  });

  test("wrong bearer token is rejected with an ApiError", async () => {
    const badClient = new TaskNotesClient({
      baseUrl: BASE_URL,
      authToken: "wrong-token",
    });
    const result = await badClient.listTasks();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe("ApiError");
    }
  });
});

describe("task CRUD round-trip", () => {
  let created: Task;

  test("createTask round-trips every basic field", async () => {
    created = unwrap(
      await client.createTask({
        title: "Contract test task",
        priority: "high",
        due: "2026-07-10",
        details: "Body written by the contract test.",
        tags: ["contract"],
        contexts: ["home"],
        projects: ["Testing"],
      }),
    );
    expect(created.title).toBe("Contract test task");
    expect(created.priority).toBe("high");
    expect(created.due).toBe("2026-07-10");
    expect(created.details).toBe("Body written by the contract test.");
    expect(created.tags.map(String)).toContain("contract");
    expect(created.contexts.map(String)).toContain("home");
    expect(created.projects.map(String)).toContain("Testing");
    expect(String(created.id).length).toBeGreaterThan(0);
  });

  test("getTask returns the created task; unknown id is NotFoundError", async () => {
    const fetched = unwrap(await client.getTask(created.id));
    expect(fetched.title).toBe("Contract test task");

    const missing = await client.getTask(taskId("does-not-exist"));
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.name).toBe("NotFoundError");
    }
  });

  test("listTasks includes the created task", async () => {
    const tasks = unwrap(await client.listTasks());
    expect(tasks.some((t) => t.id === created.id)).toBe(true);
  });

  test("updateTask applies a partial update and preserves other fields", async () => {
    const updated = unwrap(
      await client.updateTask(created.id, { priority: "low" }),
    );
    expect(updated.priority).toBe("low");
    expect(updated.title).toBe("Contract test task");
    expect(updated.details).toBe("Body written by the contract test.");
  });

  test("toggleTaskStatus sets the requested status", async () => {
    const toggled = unwrap(await client.toggleTaskStatus(created.id, "done"));
    expect(toggled.status).toBe("done");
  });

  test("archiveTask succeeds", async () => {
    const archived = await client.archiveTask(created.id);
    expect(archived.ok).toBe(true);
  });

  test("deleteTask removes the task", async () => {
    const deleted = await client.deleteTask(created.id);
    expect(deleted.ok).toBe(true);
    const gone = await client.getTask(created.id);
    expect(gone.ok).toBe(false);
  });
});

describe("recurring completion (current contract: server-today TOGGLE)", () => {
  test("complete-instance toggles today's instance on and off", async () => {
    const recurring = unwrap(
      await client.createTask({
        title: "Water plants",
        recurrence: "FREQ=DAILY",
      }),
    );
    const today = localTodayYmd();

    const first = unwrap(await client.completeRecurringInstance(recurring.id));
    expect(first.completeInstances.map(String)).toContain(today);

    // Second call un-completes — this is the toggle behavior the P1 patch
    // extends with explicit {date, completed} set-semantics.
    const second = unwrap(await client.completeRecurringInstance(recurring.id));
    expect(second.completeInstances.map(String)).not.toContain(today);

    await client.deleteTask(recurring.id);
  });
});

describe("query, stats, filter options", () => {
  test("queryTasks with a flat filter succeeds", async () => {
    const created = unwrap(
      await client.createTask({ title: "Query target", priority: "high" }),
    );
    const result = unwrap(await client.queryTasks({ priority: ["high"] }));
    expect(result.tasks.some((t) => t.id === created.id)).toBe(true);
    await client.deleteTask(created.id);
  });

  test("getStats and getFilterOptions parse", async () => {
    const stats = unwrap(await client.getStats());
    expect(stats.total).toBeGreaterThanOrEqual(0);
    const options = await client.getFilterOptions();
    expect(options.ok).toBe(true);
  });
});

describe("NLP endpoints", () => {
  test("parseNaturalLanguage extracts fields", async () => {
    const parsed = unwrap(
      await client.parseNaturalLanguage("Buy milk tomorrow !high #errand"),
    );
    expect(parsed.title.length).toBeGreaterThan(0);
  });

  test("createFromNaturalLanguage creates a task", async () => {
    const result = await client.createFromNaturalLanguage(
      "Call dentist @phone",
    );
    expect(result.ok).toBe(true);
  });
});

describe("time tracking (current contract)", () => {
  test("start/stop tracking and per-task time parse", async () => {
    const tracked = unwrap(await client.createTask({ title: "Tracked" }));

    const started = await client.startTimeTracking(tracked.id);
    expect(started.ok).toBe(true);
    const stopped = await client.stopTimeTracking(tracked.id);
    expect(stopped.ok).toBe(true);

    const time = unwrap(await client.getTaskTime(tracked.id));
    expect(time.hasActiveSession).toBe(false); // stopped above
    expect(time.totalTime).toBeGreaterThanOrEqual(0);

    await client.deleteTask(tracked.id);
  });

  test("time summary responds with the v2 report shape", async () => {
    // Review finding #16 (route-shadowed always-empty summary) is fixed by
    // the P3 rebuild — this now asserts a real report.
    const summary = unwrap(await client.getTimeSummary());
    expect(summary.totalTime).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(summary.topTasks)).toBe(true);
  });
});

describe("pomodoro & calendar", () => {
  test("pomodoro start/status/pause/stop parse", async () => {
    const started = await client.startPomodoro();
    expect(started.ok).toBe(true);
    const status = await client.getPomodoroStatus();
    expect(status.ok).toBe(true);
    const paused = await client.pausePomodoro();
    expect(paused.ok).toBe(true);
    const stopped = await client.stopPomodoro();
    expect(stopped.ok).toBe(true);
  });

  test("calendar events parse", async () => {
    // The server's default calendar window is [today, today+30d] — the due
    // date must be dynamic or the test starts failing once the date passes.
    const withDue = unwrap(
      await client.createTask({ title: "Due event", due: localTodayYmd() }),
    );
    const events = unwrap(await client.getCalendarEvents());
    expect(events.some((e) => e.title.includes("Due event"))).toBe(true);
    await client.deleteTask(withDue.id);
  });
});
