import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";

import { taskRoutes } from "../routes/tasks.ts";
import { nlpRoutes } from "../routes/nlp.ts";
import { healthRoutes } from "../routes/health.ts";
import { pomodoroRoutes } from "../routes/pomodoro.ts";
import { timeRoutes } from "../routes/time.ts";
import { calendarRoutes } from "../routes/calendar.ts";
import { TaskStore } from "../store/task-store.ts";
import { TimeStore } from "../store/time-store.ts";
import { PomodoroStore } from "../store/pomodoro-store.ts";

let tempDir: string;
let app: Hono;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "tasknotes-routes-"));
  const taskStore = new TaskStore(tempDir, "");
  await taskStore.init();
  const timeStore = new TimeStore(tempDir);
  const pomodoroStore = new PomodoroStore();

  app = new Hono();
  app.route("/", healthRoutes);
  app.route("/", taskRoutes(taskStore));
  app.route("/", nlpRoutes(taskStore));
  app.route("/", timeRoutes(timeStore));
  app.route("/", pomodoroRoutes(pomodoroStore));
  app.route("/", calendarRoutes(taskStore));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function makeRequest(
  method: string,
  url: string,
  body?: unknown,
): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return app.request(url, init);
}

// JSON.parse returns any, which allows property access without type assertions
async function jsonBody(res: Response) {
  return JSON.parse(await res.text());
}

async function createTask(body: Record<string, unknown>) {
  const res = await makeRequest("POST", "/api/tasks", body);
  return jsonBody(res);
}

describe("health", () => {
  test("GET /api/health returns ok", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.status).toBe("ok");
    expect(data.version).toBe("0.1.0");
  });
});

describe("tasks CRUD", () => {
  test("GET /api/tasks returns empty list initially", async () => {
    const res = await makeRequest("GET", "/api/tasks");
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.tasks).toEqual([]);
    expect(data.pagination.total).toBe(0);
  });

  test("POST /api/tasks creates a task", async () => {
    const res = await makeRequest("POST", "/api/tasks", {
      title: "New task",
      priority: "high",
    });
    expect(res.status).toBe(201);
    const task = await jsonBody(res);
    expect(task.title).toBe("New task");
    expect(task.priority).toBe("high");
    expect(task.id).toBeDefined();
  });

  test("GET /api/tasks/:id returns task", async () => {
    const created = await createTask({ title: "Get me" });
    const res = await makeRequest("GET", `/api/tasks/${String(created.id)}`);
    expect(res.status).toBe(200);
    const task = await jsonBody(res);
    expect(task.title).toBe("Get me");
  });

  test("GET /api/tasks/:id returns 404 for missing task", async () => {
    const res = await makeRequest("GET", "/api/tasks/nonexistent");
    expect(res.status).toBe(404);
  });

  test("PUT /api/tasks/:id updates task", async () => {
    const created = await createTask({ title: "Original" });
    const res = await makeRequest("PUT", `/api/tasks/${String(created.id)}`, {
      title: "Updated",
    });
    expect(res.status).toBe(200);
    const task = await jsonBody(res);
    expect(task.title).toBe("Updated");
  });

  test("DELETE /api/tasks/:id deletes task", async () => {
    const created = await createTask({ title: "Delete me" });
    const res = await makeRequest("DELETE", `/api/tasks/${String(created.id)}`);
    expect(res.status).toBe(200);

    const getRes = await makeRequest("GET", `/api/tasks/${String(created.id)}`);
    expect(getRes.status).toBe(404);
  });

  test("POST /api/tasks/:id/archive archives task", async () => {
    const created = await createTask({ title: "Archive me" });
    const res = await makeRequest(
      "POST",
      `/api/tasks/${String(created.id)}/archive`,
    );
    expect(res.status).toBe(200);

    const listRes = await makeRequest("GET", "/api/tasks");
    const list = await jsonBody(listRes);
    expect(list.tasks.length).toBe(0);
  });

  test("POST /api/tasks/:id/complete-instance completes task", async () => {
    const created = await createTask({
      title: "Recurring",
      recurrence: "every week",
    });
    const res = await makeRequest(
      "POST",
      `/api/tasks/${String(created.id)}/complete-instance`,
    );
    expect(res.status).toBe(200);
    const task = await jsonBody(res);
    expect(task.status).toBe("done");
  });
});

describe("tasks query", () => {
  test("POST /api/tasks/query with status filter", async () => {
    await createTask({ title: "Open task" });
    await createTask({ title: "Done task", status: "done" });

    const res = await makeRequest("POST", "/api/tasks/query", {
      status: ["open"],
    });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.tasks.length).toBe(1);
    expect(data.tasks[0].title).toBe("Open task");
  });

  test("GET /api/stats returns stats", async () => {
    await createTask({ title: "Task 1" });
    await createTask({ title: "Task 2", status: "done" });

    const res = await makeRequest("GET", "/api/stats");
    expect(res.status).toBe(200);
    const stats = await jsonBody(res);
    expect(stats.total).toBe(2);
    expect(stats.active).toBe(1);
    expect(stats.completed).toBe(1);
  });

  test("GET /api/filter-options returns filter options", async () => {
    await createTask({
      title: "Task",
      contexts: ["home"],
      projects: ["ProjectA"],
      tags: ["urgent"],
    });

    const res = await makeRequest("GET", "/api/filter-options");
    expect(res.status).toBe(200);
    const filters = await jsonBody(res);
    expect(filters.contexts).toContain("home");
    expect(filters.projects).toContain("ProjectA");
    expect(filters.tags).toContain("urgent");
  });
});

describe("NLP", () => {
  test("POST /api/nlp/parse parses text", async () => {
    const res = await makeRequest("POST", "/api/nlp/parse", {
      text: "Buy groceries !high @home",
    });
    expect(res.status).toBe(200);
    const result = await jsonBody(res);
    expect(result.title).toBe("Buy groceries");
    expect(result.priority).toBe("high");
    expect(result.contexts).toEqual(["home"]);
  });

  test("POST /api/nlp/create creates task from text", async () => {
    const res = await makeRequest("POST", "/api/nlp/create", {
      text: "Fix bug !high p:Backend",
    });
    expect(res.status).toBe(201);
    const task = await jsonBody(res);
    expect(task.title).toBe("Fix bug");
    expect(task.priority).toBe("high");
    expect(task.projects).toEqual(["Backend"]);
  });
});

describe("pomodoro", () => {
  test("GET /api/pomodoro/status returns inactive initially", async () => {
    const res = await makeRequest("GET", "/api/pomodoro/status");
    expect(res.status).toBe(200);
    const status = await jsonBody(res);
    expect(status.active).toBe(false);
  });

  test("POST /api/pomodoro/start starts pomodoro", async () => {
    const res = await makeRequest("POST", "/api/pomodoro/start", {});
    expect(res.status).toBe(200);
    const status = await jsonBody(res);
    expect(status.active).toBe(true);
    expect(status.type).toBe("work");
  });

  test("POST /api/pomodoro/stop stops pomodoro", async () => {
    await makeRequest("POST", "/api/pomodoro/start", {});
    const res = await makeRequest("POST", "/api/pomodoro/stop");
    expect(res.status).toBe(200);
    const status = await jsonBody(res);
    expect(status.active).toBe(false);
  });
});

describe("calendar", () => {
  test("GET /api/calendar/events returns events from tasks with due dates", async () => {
    await createTask({ title: "Due task", due: "2026-03-01" });
    await createTask({ title: "No due date" });

    const res = await makeRequest("GET", "/api/calendar/events");
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.events.length).toBe(1);
    expect(data.events[0].title).toBe("Due task");
    expect(data.events[0].date).toBe("2026-03-01");
  });

  test("GET /api/calendar/events filters by date range", async () => {
    await createTask({ title: "Early", due: "2026-01-01" });
    await createTask({ title: "Mid", due: "2026-06-15" });
    await createTask({ title: "Late", due: "2026-12-31" });

    const res = await makeRequest(
      "GET",
      "/api/calendar/events?start=2026-06-01&end=2026-07-01",
    );
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.events.length).toBe(1);
    expect(data.events[0].title).toBe("Mid");
  });
});
