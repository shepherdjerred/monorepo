import { beforeEach, describe, expect, test } from "bun:test";

import { ApiError } from "../../domain/errors";
import type { Task, TaskId } from "../../domain/types";
import { taskId } from "../../domain/types";
import { CommandQueue } from "../sync/CommandQueue";
import {
  type MemoryQueueStorage,
  type MemoryStoreStorage,
  makeTask,
  memoryQueueStorage,
  memoryStoreStorage,
} from "../sync/__tests__/harness";
import { TaskStore } from "./TaskStore";

let now = 1_750_000_000_000;
const clock = () => now;

function makeStore(
  queueStorage = memoryQueueStorage(),
  storeStorage = memoryStoreStorage(),
): {
  store: TaskStore;
  queueStorage: MemoryQueueStorage;
  storeStorage: MemoryStoreStorage;
  queue: CommandQueue;
} {
  const queue = new CommandQueue(queueStorage, clock);
  const store = new TaskStore(queue, storeStorage, clock);
  return { store, queueStorage, storeStorage, queue };
}

beforeEach(() => {
  now = 1_750_000_000_000;
});

function viewIds(m: ReadonlyMap<TaskId, Task>): string[] {
  return [...m.keys()].map(String);
}

describe("TaskStore view = rebase(base, pending)", () => {
  test("restore loads the cached base; empty queue means view === base content", async () => {
    const seeded = makeTask();
    const { store } = makeStore(
      memoryQueueStorage(),
      memoryStoreStorage({ tasks: [seeded], lastSync: 123 }),
    );
    await store.restore();
    const snap = store.getSnapshot();
    expect(snap.tasks.get(seeded.id)?.title).toBe("Test");
    expect(snap.pendingCount).toBe(0);
    expect(snap.lastSyncTime).toBe(123);
  });

  test("dispatch create materializes an optimistic task and notifies", async () => {
    const { store } = makeStore();
    await store.restore();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    let syncRequested = 0;
    store.onDispatch = () => {
      syncRequested += 1;
    };

    const before = store.getSnapshot();
    const optimistic = await store.dispatch({
      type: "create",
      payload: { title: "Offline task" },
    });

    expect(optimistic?.title).toBe("Offline task");
    expect(String(optimistic?.id).startsWith("tmp-")).toBe(true);
    expect(notified).toBe(1);
    expect(syncRequested).toBe(1);
    const after = store.getSnapshot();
    expect(after).not.toBe(before); // referential change for useSyncExternalStore
    expect(after.pendingCount).toBe(1);
    expect(after.tasks.size).toBe(1);
  });

  test("dispatch update/set_status layer over the base without mutating it", async () => {
    const seeded = makeTask();
    const { store } = makeStore(
      memoryQueueStorage(),
      memoryStoreStorage({ tasks: [seeded] }),
    );
    await store.restore();

    await store.dispatch({
      type: "update",
      taskId: seeded.id,
      payload: { title: "Renamed" },
    });
    await store.dispatch({
      type: "set_status",
      taskId: seeded.id,
      status: "done",
    });

    const view = store.getSnapshot().tasks.get(seeded.id);
    expect(view?.title).toBe("Renamed");
    expect(view?.status).toBe("done");
    expect(seeded.title).toBe("Test"); // base object untouched
  });

  test("deleting a still-pending offline create removes it from the view (squash)", async () => {
    const { store } = makeStore();
    await store.restore();
    const optimistic = await store.dispatch({
      type: "create",
      payload: { title: "Ephemeral" },
    });
    if (optimistic === undefined) throw new Error("expected optimistic task");
    await store.dispatch({ type: "delete", taskId: optimistic.id });

    const snap = store.getSnapshot();
    expect(snap.tasks.size).toBe(0);
    expect(snap.pendingCount).toBe(0);
  });
});

describe("TaskStore server acks", () => {
  test("create ack: alias recorded, queued followups remapped, base updated", async () => {
    const { store, queue } = makeStore();
    await store.restore();
    const optimistic = await store.dispatch({
      type: "create",
      payload: { title: "New" },
    });
    if (optimistic === undefined) throw new Error("expected optimistic task");
    await store.dispatch({
      type: "update",
      taskId: optimistic.id,
      payload: { title: "New v2" },
    });

    const createCmd = queue.head();
    if (createCmd?.type !== "create") throw new Error("expected create head");
    const real = makeTask({
      id: taskId("TaskNotes/New.md"),
      path: "TaskNotes/New.md",
      title: "New",
    });
    await store.applyServerAck(createCmd, real);

    // alias resolves temp → real for UI surfaces holding the old id
    expect(store.resolveTaskId(optimistic.id)).toBe(real.id);
    // the queued update now targets the real id
    const next = queue.head();
    expect(next?.type === "update" && next.taskId).toBe(real.id);
    // view: real task with the pending rename layered on top; temp id gone
    const snap = store.getSnapshot();
    expect(snap.tasks.has(optimistic.id)).toBe(false);
    expect(snap.tasks.get(real.id)?.title).toBe("New v2");
    expect(snap.pendingCount).toBe(1);
  });

  test("dispatch against a stale temp id after the ack resolves via alias", async () => {
    const { store, queue } = makeStore();
    await store.restore();
    const optimistic = await store.dispatch({
      type: "create",
      payload: { title: "New" },
    });
    if (optimistic === undefined) throw new Error("expected optimistic task");
    const createCmd = queue.head();
    if (createCmd?.type !== "create") throw new Error("expected create head");
    const real = makeTask({ id: taskId("TaskNotes/New.md"), title: "New" });
    await store.applyServerAck(createCmd, real);

    // UI held the temp id (e.g. an open detail screen) and dispatches with it
    await store.dispatch({
      type: "set_status",
      taskId: optimistic.id,
      status: "done",
    });
    const cmd = queue.head();
    expect(cmd?.type === "set_status" && cmd.taskId).toBe(real.id);
    expect(store.getSnapshot().tasks.get(real.id)?.status).toBe("done");
  });

  test("delete ack removes from base; update ack merges the server task", async () => {
    const seeded = makeTask();
    const other = makeTask({
      id: taskId("TaskNotes/other.md"),
      path: "TaskNotes/other.md",
    });
    const { store, queue } = makeStore(
      memoryQueueStorage(),
      memoryStoreStorage({ tasks: [seeded, other] }),
    );
    await store.restore();

    await store.dispatch({
      type: "update",
      taskId: seeded.id,
      payload: { title: "Renamed" },
    });
    const updateCmd = queue.head();
    if (updateCmd === undefined) throw new Error("expected head");
    await store.applyServerAck(updateCmd, {
      ...seeded,
      title: "Renamed (server)",
    });
    expect(store.getSnapshot().tasks.get(seeded.id)?.title).toBe(
      "Renamed (server)",
    );

    await store.dispatch({ type: "delete", taskId: other.id });
    const deleteCmd = queue.head();
    if (deleteCmd === undefined) throw new Error("expected head");
    await store.applyServerAck(deleteCmd, null);
    expect(store.getSnapshot().tasks.has(other.id)).toBe(false);
    expect(store.getSnapshot().pendingCount).toBe(0);
  });
});

describe("TaskStore replaceBase", () => {
  test("full pull replaces the base, keeps pending layered, prunes dead aliases", async () => {
    const { store, queue } = makeStore();
    await store.restore();
    const optimistic = await store.dispatch({
      type: "create",
      payload: { title: "Mine" },
    });
    if (optimistic === undefined) throw new Error("expected optimistic task");
    const createCmd = queue.head();
    if (createCmd?.type !== "create") throw new Error("expected create head");
    const real = makeTask({ id: taskId("TaskNotes/Mine.md"), title: "Mine" });
    await store.applyServerAck(createCmd, real);
    expect(store.resolveTaskId(optimistic.id)).toBe(real.id);

    // second pending mutation survives the pull
    await store.dispatch({
      type: "set_status",
      taskId: real.id,
      status: "done",
    });

    // server pull no longer contains the task (deleted in Obsidian) → alias pruned
    const fromServer = makeTask({ id: taskId("TaskNotes/obsidian.md") });
    await store.replaceBase([fromServer], 42);

    const snap = store.getSnapshot();
    expect(snap.lastSyncTime).toBe(42);
    expect(snap.tasks.has(fromServer.id)).toBe(true);
    expect(snap.tasks.has(real.id)).toBe(false); // set_status on a missing task is a no-op
    expect(store.resolveTaskId(optimistic.id)).toBe(optimistic.id); // alias pruned
    expect(snap.pendingCount).toBe(1);
  });
});

describe("TaskStore dead letters", () => {
  test("dead-lettering rolls back the optimistic effect; retry re-applies it", async () => {
    const seeded = makeTask();
    const { store, queue } = makeStore(
      memoryQueueStorage(),
      memoryStoreStorage({ tasks: [seeded] }),
    );
    await store.restore();
    await store.dispatch({
      type: "update",
      taskId: seeded.id,
      payload: { title: "Rejected" },
    });
    const cmd = queue.head();
    if (cmd === undefined) throw new Error("expected head");

    await store.deadLetterCommand(cmd.id, new ApiError("invalid", 422));
    let snap = store.getSnapshot();
    expect(snap.tasks.get(seeded.id)?.title).toBe("Test"); // rolled back
    expect(snap.deadLetters).toHaveLength(1);
    expect(snap.pendingCount).toBe(0);

    let syncRequested = 0;
    store.onDispatch = () => {
      syncRequested += 1;
    };
    await store.retryDeadLetter(cmd.id);
    snap = store.getSnapshot();
    expect(snap.tasks.get(seeded.id)?.title).toBe("Rejected"); // re-applied
    expect(snap.deadLetters).toHaveLength(0);
    expect(syncRequested).toBe(1);

    await store.deadLetterCommand(cmd.id, new ApiError("invalid", 422));
    await store.discardDeadLetter(cmd.id);
    expect(store.getSnapshot().deadLetters).toHaveLength(0);
  });
});

describe("TaskStore crash recovery", () => {
  test("rebuilding from the same storage reproduces the identical view", async () => {
    const seeded = makeTask();
    const { store, queueStorage, storeStorage } = makeStore(
      memoryQueueStorage(),
      memoryStoreStorage({ tasks: [seeded] }),
    );
    await store.restore();
    await store.dispatch({ type: "create", payload: { title: "Offline" } });
    await store.dispatch({
      type: "set_status",
      taskId: seeded.id,
      status: "in-progress",
    });
    const beforeCrash = store.getSnapshot();

    // "crash": new store over cloned durable state only
    const { store: reborn } = makeStore(
      queueStorage.clone(),
      storeStorage.clone(),
    );
    await reborn.restore();
    const afterCrash = reborn.getSnapshot();

    expect(afterCrash.pendingCount).toBe(beforeCrash.pendingCount);
    expect(afterCrash.tasks.size).toBe(beforeCrash.tasks.size);
    expect(viewIds(afterCrash.tasks).sort()).toEqual(
      viewIds(beforeCrash.tasks).sort(),
    );
    expect(afterCrash.tasks.get(seeded.id)?.status).toBe("in-progress");
  });

  test("aliases survive a relaunch", async () => {
    const { store, queue, queueStorage, storeStorage } = makeStore();
    await store.restore();
    const optimistic = await store.dispatch({
      type: "create",
      payload: { title: "New" },
    });
    if (optimistic === undefined) throw new Error("expected optimistic task");
    const createCmd = queue.head();
    if (createCmd?.type !== "create") throw new Error("expected create head");
    const real = makeTask({ id: taskId("TaskNotes/New.md"), title: "New" });
    await store.applyServerAck(createCmd, real);

    const { store: reborn } = makeStore(
      queueStorage.clone(),
      storeStorage.clone(),
    );
    await reborn.restore();
    expect(reborn.resolveTaskId(optimistic.id)).toBe(real.id);
  });
});
