import { beforeEach, describe, expect, test } from "bun:test";

import { ApiError } from "../../domain/errors";
import { taskId } from "../../domain/types";
import type { Command, CreateCommand } from "./commands";
import { CommandQueue, type CommandQueueStorage } from "./CommandQueue";

function memoryStorage(): CommandQueueStorage & {
  queueRaw: () => string | null;
} {
  let queue: string | null = null;
  let dead: string | null = null;
  return {
    readQueue: () => Promise.resolve(queue),
    writeQueue: (d) => {
      queue = d;
      return Promise.resolve();
    },
    readDeadLetter: () => Promise.resolve(dead),
    writeDeadLetter: (d) => {
      dead = d;
      return Promise.resolve();
    },
    queueRaw: () => queue,
  };
}

const clock = () => 1000;

function create(tempId: string, id = `cmd-${tempId}`): CreateCommand {
  return {
    id,
    createdAt: 1,
    type: "create",
    tempId: taskId(tempId),
    payload: { title: `task ${tempId}` },
  };
}

function del(target: string, id = `del-${target}`): Command {
  return { id, createdAt: 1, type: "delete", taskId: taskId(target) };
}

describe("CommandQueue FIFO + persistence", () => {
  let storage: ReturnType<typeof memoryStorage>;
  let q: CommandQueue;

  beforeEach(async () => {
    storage = memoryStorage();
    q = new CommandQueue(storage, () => clock());
    await q.restore();
  });

  test("enqueue/head/ack are FIFO and persisted", async () => {
    await q.enqueue(create("tmp-1"));
    await q.enqueue(create("tmp-2"));
    expect(q.head()?.tempId).toBe(taskId("tmp-1"));
    await q.ack("cmd-tmp-1");
    expect(q.head()?.tempId).toBe(taskId("tmp-2"));
    expect(q.pending).toHaveLength(1);

    // rebuilt queue over the same storage restores pending state
    const q2 = new CommandQueue(storage, () => clock());
    await q2.restore();
    expect(q2.pending).toHaveLength(1);
    expect(q2.head()?.id).toBe("cmd-tmp-2");
  });

  test("remapTaskId rewrites every pending command targeting the temp id", async () => {
    await q.enqueue(create("tmp-1"));
    await q.enqueue({
      id: "u1",
      createdAt: 1,
      type: "update",
      taskId: taskId("tmp-1"),
      payload: { title: "x" },
    });
    await q.remapTaskId(taskId("tmp-1"), taskId("TaskNotes/real.md"));
    const [first, second] = q.pending;
    expect(first?.type === "create" && first.tempId).toBe(
      taskId("TaskNotes/real.md"),
    );
    expect(second?.type === "update" && second.taskId).toBe(
      taskId("TaskNotes/real.md"),
    );
  });
});

describe("CommandQueue dead-letter", () => {
  let storage: ReturnType<typeof memoryStorage>;
  let q: CommandQueue;

  beforeEach(async () => {
    storage = memoryStorage();
    q = new CommandQueue(storage, () => clock());
    await q.restore();
  });

  test("dead-letter moves a command off the queue and persists it", async () => {
    await q.enqueue(create("tmp-1"));
    await q.deadLetter("cmd-tmp-1", new ApiError("bad", 422));
    expect(q.pending).toHaveLength(0);
    expect(q.deadLetters).toHaveLength(1);
    expect(q.deadLetters[0]?.error.status).toBe(422);

    const q2 = new CommandQueue(storage, () => clock());
    await q2.restore();
    expect(q2.deadLetters).toHaveLength(1);
    expect(q2.deadLetters[0]?.command.id).toBe("cmd-tmp-1");
  });

  test("retryDeadLetter re-enqueues at the tail; discard drops it", async () => {
    await q.enqueue(create("tmp-1"));
    await q.deadLetter("cmd-tmp-1", new ApiError("bad", 500));
    await q.enqueue(create("tmp-2"));

    await q.retryDeadLetter("cmd-tmp-1");
    expect(q.deadLetters).toHaveLength(0);
    expect(q.pending.map((c) => c.id)).toEqual(["cmd-tmp-2", "cmd-tmp-1"]);

    await q.deadLetter("cmd-tmp-2", new ApiError("bad", 400));
    await q.discardDeadLetter("cmd-tmp-2");
    expect(q.deadLetters).toHaveLength(0);
  });
});

describe("CommandQueue squash create+delete", () => {
  let q: CommandQueue;

  beforeEach(async () => {
    q = new CommandQueue(memoryStorage(), () => clock());
    await q.restore();
  });

  test("deleting a still-pending offline create cancels both (never hits server)", async () => {
    await q.enqueue(create("tmp-1"));
    await q.enqueue({
      id: "u1",
      createdAt: 1,
      type: "update",
      taskId: taskId("tmp-1"),
      payload: { title: "x" },
    });
    await q.enqueue(del("tmp-1"));
    // create + its dependent update + the delete all vanish
    expect(q.pending).toHaveLength(0);
  });

  test("deleting a real (synced) task enqueues normally", async () => {
    await q.enqueue(del("TaskNotes/real.md"));
    expect(q.pending).toHaveLength(1);
    expect(q.head()?.type).toBe("delete");
  });
});
