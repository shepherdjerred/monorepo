import { beforeEach, describe, expect, test } from "bun:test";

import type { Result } from "../../domain/result";
import { ok, err } from "../../domain/result";
import type { AppError } from "../../domain/errors";
import { NetworkError } from "../../domain/errors";
import type {
  CreateTaskRequest,
  Task,
  TaskId,
  UpdateTaskRequest,
} from "../../domain/types";
import { taskId } from "../../domain/types";
import type { TaskStatus } from "../../domain/status";
import type { Mutation, MutationStorage } from "./MutationQueue";
import { MutationQueue } from "./MutationQueue";
import type { SyncClient, TaskCacheStorage } from "./SyncEngine";
import { SyncEngine } from "./SyncEngine";

function makeCache(): TaskCacheStorage {
  let tasks: Task[] = [];
  let lastSync: number | null = null;
  return {
    async getTasks() {
      return tasks;
    },
    async setTasks(value) {
      tasks = value;
    },
    async getLastSyncTime() {
      return lastSync;
    },
    async setLastSyncTime(value) {
      lastSync = value;
    },
  };
}

function makeStorage(): MutationStorage {
  let value: string | null = null;
  return {
    async read() {
      return value;
    },
    async write(data: string) {
      value = data;
    },
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const base: Task = {
    id: taskId("task-1"),
    path: "tasks/task-1.md",
    title: "Test",
    status: "open",
    priority: "normal",
    contexts: [],
    projects: [],
    tags: [],
    completeInstances: [],
    skippedInstances: [],
    timeEntries: [],
    blockedBy: [],
    reminders: [],
    archived: false,
    totalTrackedTime: 0,
    isBlocked: false,
    isBlocking: false,
    extraFields: {},
  };
  return { ...base, ...overrides };
}

function makeFakeClient(
  opts: {
    listResult?: Result<Task[], AppError>;
    failOn?: ReadonlySet<string>;
  } = {},
): SyncClient {
  const fail = (id: TaskId): Result<Task, AppError> | null =>
    opts.failOn?.has(String(id)) === true
      ? err(new NetworkError("forced"))
      : null;
  const failVoid = (id: TaskId): Result<void, AppError> | null =>
    opts.failOn?.has(String(id)) === true
      ? err(new NetworkError("forced"))
      : null;
  return {
    listTasks: async () => opts.listResult ?? ok([]),
    createTask: async (_payload: CreateTaskRequest) =>
      ok(makeTask({ id: taskId("server-1") })),
    updateTask: async (id: TaskId, _payload: UpdateTaskRequest) =>
      fail(id) ?? ok(makeTask({ id })),
    deleteTask: async (id: TaskId) => failVoid(id) ?? ok(),
    toggleTaskStatus: async (id: TaskId, status: TaskStatus) =>
      fail(id) ?? ok(makeTask({ id, status })),
    completeRecurringInstance: async (id: TaskId) =>
      fail(id) ?? ok(makeTask({ id })),
  };
}

let queue: MutationQueue;
let captured: Task[] = [];

beforeEach(() => {
  queue = new MutationQueue(makeStorage());
  captured = [];
});

describe("SyncEngine.fullSync", () => {
  test("returns ConnectionError when client is null", async () => {
    const engine = new SyncEngine(
      null,
      queue,
      (list) => {
        captured = list;
      },
      makeCache(),
    );
    const result = await engine.fullSync();
    expect(result.ok).toBe(false);
    expect(captured).toEqual([]);
  });

  test("fetches tasks and notifies via callback", async () => {
    const fromServer = [
      makeTask({ id: taskId("a") }),
      makeTask({ id: taskId("b") }),
    ];
    const client = makeFakeClient({ listResult: ok(fromServer) });
    const engine = new SyncEngine(
      client,
      queue,
      (list) => {
        captured = list;
      },
      makeCache(),
    );
    const result = await engine.fullSync();
    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(2);
    expect(captured.map((t) => String(t.id)).sort()).toEqual(["a", "b"]);
  });

  test("replays pending queue before fetching", async () => {
    await queue.enqueue({
      type: "complete_instance",
      taskId: taskId("recurring-1"),
    });
    const client = makeFakeClient({ listResult: ok([]) });
    const engine = new SyncEngine(
      client,
      queue,
      (list) => {
        captured = list;
      },
      makeCache(),
    );
    await engine.fullSync();
    expect(queue.isEmpty).toBe(true);
  });

  test("re-applies remaining (failed) mutations to server tasks", async () => {
    await queue.enqueue({
      type: "complete_instance",
      taskId: taskId("recurring-1"),
    });
    const fromServer = [
      makeTask({ id: taskId("recurring-1"), recurrence: "FREQ=DAILY" }),
    ];
    const client = makeFakeClient({
      listResult: ok(fromServer),
      failOn: new Set(["recurring-1"]),
    });
    const engine = new SyncEngine(
      client,
      queue,
      (list) => {
        captured = list;
      },
      makeCache(),
    );
    await engine.fullSync();
    expect(queue.pending).toHaveLength(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.completeInstances.length).toBeGreaterThan(0);
  });
});

describe("SyncEngine.applyOptimistic", () => {
  let engine: SyncEngine;

  beforeEach(() => {
    engine = new SyncEngine(
      null,
      queue,
      () => {
        // not used in these unit tests
      },
      makeCache(),
    );
  });

  test("toggle_status flips open → done", () => {
    const tasks = new Map<TaskId, Task>([
      [taskId("t1"), makeTask({ id: taskId("t1"), status: "open" })],
    ]);
    const mutation: Mutation = {
      id: "1",
      timestamp: 1,
      type: "toggle_status",
      taskId: taskId("t1"),
      payload: { status: "done" },
    };
    const result = engine.applyOptimistic(mutation, tasks);
    expect(result.get(taskId("t1"))?.status).toBe("done");
  });

  test("complete_instance toggles today on recurring task", () => {
    const tasks = new Map<TaskId, Task>([
      [taskId("t1"), makeTask({ id: taskId("t1"), recurrence: "FREQ=DAILY" })],
    ]);
    const mutation: Mutation = {
      id: "1",
      timestamp: 1,
      type: "complete_instance",
      taskId: taskId("t1"),
    };
    const result = engine.applyOptimistic(mutation, tasks);
    const updated = result.get(taskId("t1"));
    expect(updated?.completeInstances).toHaveLength(1);
    expect(updated?.status).toBe("open");
  });

  test("delete removes task from map", () => {
    const tasks = new Map<TaskId, Task>([
      [taskId("t1"), makeTask({ id: taskId("t1") })],
    ]);
    const mutation: Mutation = {
      id: "1",
      timestamp: 1,
      type: "delete",
      taskId: taskId("t1"),
    };
    const result = engine.applyOptimistic(mutation, tasks);
    expect(result.has(taskId("t1"))).toBe(false);
  });

  test("update merges payload onto existing task", () => {
    const tasks = new Map<TaskId, Task>([
      [
        taskId("t1"),
        makeTask({ id: taskId("t1"), title: "Old", priority: "normal" }),
      ],
    ]);
    const mutation: Mutation = {
      id: "1",
      timestamp: 1,
      type: "update",
      taskId: taskId("t1"),
      payload: { title: "New", priority: "high" },
    };
    const result = engine.applyOptimistic(mutation, tasks);
    const updated = result.get(taskId("t1"));
    expect(updated?.title).toBe("New");
    expect(updated?.priority).toBe("high");
  });

  test("create is a no-op (server provides real id)", () => {
    const tasks = new Map<TaskId, Task>();
    const mutation: Mutation = {
      id: "1",
      timestamp: 1,
      type: "create",
      payload: { title: "New" },
    };
    const result = engine.applyOptimistic(mutation, tasks);
    expect(result.size).toBe(0);
  });
});
