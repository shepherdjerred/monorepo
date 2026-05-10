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
import type { MutationClient, MutationStorage } from "./MutationQueue";
import { MutationQueue } from "./MutationQueue";

function makeStorage(): MutationStorage & { snapshot: () => string | null } {
  let value: string | null = null;
  return {
    async read() {
      return value;
    },
    async write(data: string) {
      value = data;
    },
    snapshot() {
      return value;
    },
  };
}

type ClientCall =
  | { type: "create"; payload: CreateTaskRequest }
  | { type: "update"; taskId: TaskId; payload: UpdateTaskRequest }
  | { type: "delete"; taskId: TaskId }
  | { type: "toggle"; taskId: TaskId; status: TaskStatus }
  | { type: "completeInstance"; taskId: TaskId };

type FakeClient = MutationClient & { calls: ClientCall[] };

function makeFakeClient(
  opts: {
    failTaskIds?: ReadonlySet<string>;
  } = {},
): FakeClient {
  const calls: ClientCall[] = [];
  const stubTask: Task = {
    id: taskId("created-1"),
    path: "tasks/created-1.md",
    title: "stub",
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
  const fail = (id: string): Result<Task, AppError> | null => {
    if (opts.failTaskIds?.has(id) === true) {
      return err(new NetworkError(`forced failure for ${id}`));
    }
    return null;
  };
  const failVoid = (id: string): Result<void, AppError> | null => {
    if (opts.failTaskIds?.has(id) === true) {
      return err(new NetworkError(`forced failure for ${id}`));
    }
    return null;
  };
  return {
    calls,
    async createTask(payload: CreateTaskRequest) {
      calls.push({ type: "create", payload });
      return ok(stubTask);
    },
    async updateTask(id: TaskId, payload: UpdateTaskRequest) {
      calls.push({ type: "update", taskId: id, payload });
      return fail(String(id)) ?? ok({ ...stubTask, id });
    },
    async deleteTask(id: TaskId) {
      calls.push({ type: "delete", taskId: id });
      return failVoid(String(id)) ?? ok();
    },
    async toggleTaskStatus(id: TaskId, status: TaskStatus) {
      calls.push({ type: "toggle", taskId: id, status });
      return fail(String(id)) ?? ok({ ...stubTask, id, status });
    },
    async completeRecurringInstance(id: TaskId) {
      calls.push({ type: "completeInstance", taskId: id });
      return fail(String(id)) ?? ok({ ...stubTask, id });
    },
  };
}

let queue: MutationQueue;
let storage: ReturnType<typeof makeStorage>;

beforeEach(() => {
  storage = makeStorage();
  queue = new MutationQueue(storage);
});

describe("MutationQueue.enqueue", () => {
  test("appends create mutation and persists", async () => {
    await queue.enqueue({
      type: "create",
      payload: { title: "New task" },
    });
    expect(queue.pending).toHaveLength(1);
    expect(queue.pending[0]?.type).toBe("create");
    expect(storage.snapshot()).not.toBeNull();
  });

  test("appends complete_instance mutation", async () => {
    const id = taskId("task-1");
    await queue.enqueue({ type: "complete_instance", taskId: id });
    expect(queue.pending).toHaveLength(1);
    const entry = queue.pending[0];
    expect(entry?.type).toBe("complete_instance");
    expect(entry?.type === "complete_instance" && entry.taskId).toBe(id);
  });

  test("returns the persisted entry with id and timestamp", async () => {
    const entry = await queue.enqueue({
      type: "delete",
      taskId: taskId("task-x"),
    });
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeGreaterThan(0);
  });
});

describe("MutationQueue.persist + restore round-trip", () => {
  test("restores all four extant mutation types", async () => {
    await queue.enqueue({ type: "create", payload: { title: "A" } });
    await queue.enqueue({
      type: "update",
      taskId: taskId("t1"),
      payload: { title: "renamed" },
    });
    await queue.enqueue({ type: "delete", taskId: taskId("t2") });
    await queue.enqueue({
      type: "toggle_status",
      taskId: taskId("t3"),
      payload: { status: "done" },
    });
    await queue.enqueue({
      type: "complete_instance",
      taskId: taskId("t4"),
    });

    const restored = new MutationQueue(storage);
    await restored.restore();
    expect(restored.pending).toHaveLength(5);
    expect(restored.pending.map((m) => m.type)).toEqual([
      "create",
      "update",
      "delete",
      "toggle_status",
      "complete_instance",
    ]);
  });

  test("ignores invalid persisted entries", async () => {
    await storage.write(
      JSON.stringify([
        { type: "create", payload: { title: "ok" }, id: "1", timestamp: 1 },
        { type: "bogus", id: "2", timestamp: 2 },
        "not even an object",
      ]),
    );
    await queue.restore();
    expect(queue.pending).toHaveLength(1);
    expect(queue.pending[0]?.type).toBe("create");
  });

  test("missing storage yields empty queue", async () => {
    await queue.restore();
    expect(queue.isEmpty).toBe(true);
  });
});

describe("MutationQueue.replay", () => {
  test("drains all successful mutations", async () => {
    await queue.enqueue({ type: "create", payload: { title: "A" } });
    await queue.enqueue({
      type: "complete_instance",
      taskId: taskId("t1"),
    });
    const client = makeFakeClient();
    const results = await queue.replay(client);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(queue.pending).toHaveLength(0);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.type).toBe("create");
    expect(client.calls[1]?.type).toBe("completeInstance");
  });

  test("leaves failed mutations queued, drains successes", async () => {
    await queue.enqueue({
      type: "toggle_status",
      taskId: taskId("good"),
      payload: { status: "done" },
    });
    await queue.enqueue({
      type: "toggle_status",
      taskId: taskId("bad"),
      payload: { status: "done" },
    });
    await queue.enqueue({
      type: "delete",
      taskId: taskId("good2"),
    });
    const client = makeFakeClient({ failTaskIds: new Set(["bad"]) });
    const results = await queue.replay(client);
    expect(results).toHaveLength(3);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    expect(results[2]?.ok).toBe(true);
    expect(queue.pending).toHaveLength(1);
    expect(queue.pending[0]?.type).toBe("toggle_status");
  });

  test("calling replay twice on a successful queue is a no-op the second time", async () => {
    await queue.enqueue({
      type: "complete_instance",
      taskId: taskId("t1"),
    });
    const client = makeFakeClient();
    await queue.replay(client);
    await queue.replay(client);
    expect(client.calls).toHaveLength(1);
  });
});
