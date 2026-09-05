import { beforeEach, describe, expect, test } from "vitest";

import { ApiError } from "../../domain/errors";
import type { Task, TaskId } from "../../domain/types";
import { taskId } from "../../domain/types";
import { CommandQueue } from "../sync/CommandQueue";
import { makeTask } from "../sync/__tests__/harness";
import {
  type MemoryQueueStorage,
  type MemoryStoreStorage,
  memoryQueueStorage,
  memoryStoreStorage,
} from "../sync/__tests__/harness-storage";
import { TaskStore } from "./TaskStore";

let now = 1_750_000_000_000;
const clock = () => now;

function makeStore(
  queueStorage = memoryQueueStorage(),
  storeStorage = memoryStoreStorage(),
  // Pinned by default. `Math.random()` in the id suffix would hide an id
  // collision behind luck; the id-collision tests below need it deterministic.
  random: () => number = () => 0.5,
): {
  store: TaskStore;
  queueStorage: MemoryQueueStorage;
  storeStorage: MemoryStoreStorage;
  queue: CommandQueue;
} {
  const queue = new CommandQueue(queueStorage, clock);
  const store = new TaskStore(queue, storeStorage, clock, random);
  return { store, queueStorage, storeStorage, queue };
}

const OCCURRENCE_DATE = "2026-08-08";

type CompletionHarnessOptions = Readonly<{
  task?: Task;
  queueStorage?: MemoryQueueStorage;
  storeStorage?: MemoryStoreStorage;
}>;

function recurringTask(overrides: Partial<Task> = {}): Task {
  return makeTask({
    recurrence: "FREQ=WEEKLY",
    scheduled: OCCURRENCE_DATE,
    ...overrides,
  });
}

function completionRestore(task: Task) {
  return {
    scheduled: task.scheduled ?? null,
    due: task.due ?? null,
    recurrence: task.recurrence ?? "",
    skipped: false,
  };
}

async function acknowledgedCompletion(options?: CompletionHarnessOptions) {
  const task = options?.task ?? recurringTask();
  const queueStorage = options?.queueStorage ?? memoryQueueStorage();
  const storeStorage =
    options?.storeStorage ?? memoryStoreStorage({ tasks: [task] });
  const harness = makeStore(queueStorage, storeStorage);
  await harness.store.restore();
  const restore = completionRestore(task);
  await harness.store.dispatch({
    type: "set_instance_complete",
    taskId: task.id,
    date: OCCURRENCE_DATE,
    completed: true,
    restore,
  });
  const command = harness.queue.head();
  if (command?.type !== "set_instance_complete") {
    throw new Error("expected completion command");
  }
  await harness.store.applyServerAck(command, {
    ...task,
    completeInstances: [OCCURRENCE_DATE],
  });
  return { ...harness, restore, task };
}

function commandIds(queue: CommandQueue): string[] {
  return queue.pending.map((c) => c.id);
}

function tempIds(queue: CommandQueue): string[] {
  return queue.pending.flatMap((c) =>
    c.type === "create" ? [String(c.tempId)] : [],
  );
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

  test("serializes a stale-id dispatch across an in-flight create ack", async () => {
    const backingStorage = memoryStoreStorage();
    const aliasWriteStarted = Promise.withResolvers<null>();
    const releaseAliasWrite = Promise.withResolvers<null>();
    let pauseAliasWrite = false;
    const storeStorage: MemoryStoreStorage = {
      ...backingStorage,
      setIdAliases: async (data) => {
        if (pauseAliasWrite) {
          pauseAliasWrite = false;
          aliasWriteStarted.resolve(null);
          await releaseAliasWrite.promise;
        }
        await backingStorage.setIdAliases(data);
      },
    };
    const { store, queue } = makeStore(memoryQueueStorage(), storeStorage);
    await store.restore();
    const optimistic = await store.dispatch({
      type: "create",
      payload: { title: "New" },
    });
    if (optimistic === undefined) throw new Error("expected optimistic task");
    const createCmd = queue.head();
    if (createCmd?.type !== "create") throw new Error("expected create head");
    const real = makeTask({ id: taskId("TaskNotes/New.md"), title: "New" });

    pauseAliasWrite = true;
    const ack = store.applyServerAck(createCmd, real);
    await aliasWriteStarted.promise;

    // While persistence is paused, readers still observe the prior alias and
    // snapshot together. The queued dispatch waits and resolves its stale id
    // only after the acknowledgement publishes the real task.
    expect(store.resolveTaskId(optimistic.id)).toBe(optimistic.id);
    expect(store.getSnapshot().tasks.has(optimistic.id)).toBe(true);
    const dispatch = store.dispatch({
      type: "set_status",
      taskId: optimistic.id,
      status: "done",
    });

    releaseAliasWrite.resolve(null);
    await ack;
    const updated = await dispatch;
    expect(updated?.id).toBe(real.id);
    expect(updated?.status).toBe("done");
    const pending = queue.head();
    expect(pending?.type === "set_status" && pending.taskId).toBe(real.id);
  });
});

describe("TaskStore full pulls", () => {
  test("does not enqueue a required-task mutation after an in-flight pull deletes it", async () => {
    const task = makeTask();
    const backingStorage = memoryStoreStorage({ tasks: [task] });
    const baseWriteStarted = Promise.withResolvers<null>();
    const releaseBaseWrite = Promise.withResolvers<null>();
    let pauseBaseWrite = false;
    const storeStorage: MemoryStoreStorage = {
      ...backingStorage,
      setTasks: async (tasks) => {
        if (pauseBaseWrite) {
          pauseBaseWrite = false;
          baseWriteStarted.resolve(null);
          await releaseBaseWrite.promise;
        }
        await backingStorage.setTasks(tasks);
      },
    };
    const { store, queue } = makeStore(memoryQueueStorage(), storeStorage);
    await store.restore();
    let syncRequested = 0;
    store.onDispatch = () => {
      syncRequested += 1;
    };

    pauseBaseWrite = true;
    const pull = store.replaceBase([], now);
    await baseWriteStarted.promise;
    const dispatch = store.dispatchIfTaskExists({
      type: "set_status",
      taskId: task.id,
      status: "open",
    });

    releaseBaseWrite.resolve(null);
    await pull;
    await expect(dispatch).resolves.toEqual(undefined);
    expect(queue.pending).toEqual([]);
    expect(store.getSnapshot().pendingCount).toBe(0);
    expect(syncRequested).toBe(0);
  });

  test("invalidates acknowledged restores after an external recurrence edit", async () => {
    const { store, task } = await acknowledgedCompletion();

    await store.replaceBase(
      [
        {
          ...task,
          recurrence: "FREQ=MONTHLY",
          completeInstances: [OCCURRENCE_DATE],
        },
      ],
      now,
    );

    await expect(
      store.getPendingCompletionRestore(task.id, OCCURRENCE_DATE),
    ).resolves.toEqual(undefined);
  });

  test("invalidates acknowledged restores after an external skip edit", async () => {
    const { store, task } = await acknowledgedCompletion();

    await store.replaceBase(
      [
        {
          ...task,
          completeInstances: [OCCURRENCE_DATE],
          skippedInstances: [OCCURRENCE_DATE],
        },
      ],
      now,
    );

    await expect(
      store.getPendingCompletionRestore(task.id, OCCURRENCE_DATE),
    ).resolves.toEqual(undefined);
  });

  test("persists restore invalidation before a pulled base write", async () => {
    const task = makeTask({
      recurrence: "FREQ=WEEKLY",
      scheduled: "2026-08-08",
    });
    const backingStorage = memoryStoreStorage({ tasks: [task] });
    let failBaseWrite = false;
    const storeStorage = {
      ...backingStorage,
      setTasks: async (tasks: Task[]) => {
        if (failBaseWrite) throw new Error("base pull interrupted");
        await backingStorage.setTasks(tasks);
      },
    };
    const { store, queue } = makeStore(memoryQueueStorage(), storeStorage);
    await store.restore();
    const restore = {
      scheduled: "2026-08-08",
      due: null,
      recurrence: "FREQ=WEEKLY",
      skipped: false,
    };
    await store.dispatch({
      type: "set_instance_complete",
      taskId: task.id,
      date: "2026-08-08",
      completed: true,
      restore,
    });
    const command = queue.head();
    if (command?.type !== "set_instance_complete") {
      throw new Error("expected completion command");
    }
    await store.applyServerAck(command, {
      ...task,
      completeInstances: ["2026-08-08"],
    });

    failBaseWrite = true;
    await expect(
      store.replaceBase(
        [
          {
            ...task,
            recurrence: "FREQ=MONTHLY",
            completeInstances: ["2026-08-08"],
          },
        ],
        now,
      ),
    ).rejects.toThrow("base pull interrupted");

    const relaunched = makeStore(
      memoryQueueStorage(),
      backingStorage.clone(),
    ).store;
    await relaunched.restore();
    await expect(
      relaunched.getPendingCompletionRestore(task.id, "2026-08-08"),
    ).resolves.toEqual(undefined);
  });
});

describe("TaskStore restore validation", () => {
  test("surfaces malformed persisted restore JSON", async () => {
    const storeStorage = memoryStoreStorage({
      acknowledgedCompletionRestores: "not-json",
    });
    const { store } = makeStore(memoryQueueStorage(), storeStorage);

    await expect(store.restore()).rejects.toThrow();
    expect(await storeStorage.getAcknowledgedCompletionRestores()).toBe(
      "not-json",
    );
  });

  test("surfaces incompatible persisted restore shapes", async () => {
    const storeStorage = memoryStoreStorage({
      acknowledgedCompletionRestores: JSON.stringify({
        "TaskNotes/test.md\u{0}2026-08-08": { restore: { recurrence: 42 } },
      }),
    });
    const { store } = makeStore(memoryQueueStorage(), storeStorage);

    await expect(store.restore()).rejects.toThrow();
  });

  // Zeroing a counter blob that exists but does not parse re-offers ids this
  // install has already spent, and nothing downstream can catch it: the
  // collision checks see the queue and the cached base, never the alias map, so
  // a temp id minted in a repeated millisecond can equal one an acknowledged
  // create already aliased — and every edit to the new optimistic task then
  // lands on the older server task. The Rust core refuses the same bytes.
  test("surfaces malformed persisted id counters", async () => {
    const storeStorage = memoryStoreStorage({ counters: "not-json" });
    const { store } = makeStore(memoryQueueStorage(), storeStorage);

    await expect(store.restore()).rejects.toThrow(
      /id counters exist but are unreadable/,
    );
  });

  test("surfaces persisted id counters of the wrong shape", async () => {
    const storeStorage = memoryStoreStorage({
      counters: JSON.stringify({ command: 4 }),
    });
    const { store } = makeStore(memoryQueueStorage(), storeStorage);

    await expect(store.restore()).rejects.toThrow(
      /id counters exist but are unreadable/,
    );
  });

  test("an absent counter blob is a fresh install, not a failure", async () => {
    const storeStorage = memoryStoreStorage({ counters: null });
    const { store } = makeStore(memoryQueueStorage(), storeStorage);

    await store.restore();
    expect(store.getSnapshot().pendingCount).toBe(0);
  });

  test("surfaces malformed persisted restore keys", async () => {
    const storeStorage = memoryStoreStorage({
      acknowledgedCompletionRestores: JSON.stringify({
        "TaskNotes/test.md": {
          restore: {
            scheduled: "2026-08-08",
            due: null,
            recurrence: "FREQ=WEEKLY",
            skipped: false,
          },
        },
      }),
    });
    const { store } = makeStore(memoryQueueStorage(), storeStorage);

    await expect(store.restore()).rejects.toThrow();
  });
});

describe("TaskStore restore ordering", () => {
  test("keeps a restore captured after an earlier queued occurrence edit", async () => {
    const task = makeTask({
      recurrence: "FREQ=WEEKLY",
      scheduled: "2026-08-08",
    });
    const { store, queue } = makeStore(
      memoryQueueStorage(),
      memoryStoreStorage({ tasks: [task] }),
    );
    await store.restore();
    const restore = {
      scheduled: "2026-08-08",
      due: null,
      recurrence: "FREQ=MONTHLY",
      skipped: false,
    };
    await store.dispatch({
      type: "update",
      taskId: task.id,
      payload: { recurrence: "FREQ=MONTHLY" },
    });
    await store.dispatch({
      type: "set_instance_complete",
      taskId: task.id,
      date: "2026-08-08",
      completed: true,
      restore,
    });

    expect(queue.pending).toHaveLength(2);
    await expect(
      store.getPendingCompletionRestore(task.id, "2026-08-08"),
    ).resolves.toEqual(restore);
  });

  test("classifies later edits against the state at completion", async () => {
    const task = makeTask({
      recurrence: "FREQ=WEEKLY",
      scheduled: "2026-08-08",
    });
    const { store } = makeStore(
      memoryQueueStorage(),
      memoryStoreStorage({ tasks: [task] }),
    );
    await store.restore();
    const restore = {
      scheduled: "2026-08-15",
      due: null,
      recurrence: "FREQ=WEEKLY",
      skipped: false,
    };
    await store.dispatch({
      type: "update",
      taskId: task.id,
      payload: { scheduled: "2026-08-15" },
    });
    await store.dispatch({
      type: "set_instance_complete",
      taskId: task.id,
      date: "2026-08-08",
      completed: true,
      restore,
    });
    await store.dispatch({
      type: "update",
      taskId: task.id,
      payload: { title: "Renamed", scheduled: "2026-08-15" },
    });

    await expect(
      store.getPendingCompletionRestore(task.id, "2026-08-08"),
    ).resolves.toEqual(restore);
  });
});

describe("TaskStore restore retention", () => {
  test("retains a restore for an update with unchanged schedule fields", async () => {
    const { store, queue, restore, task } = await acknowledgedCompletion({
      task: recurringTask({ due: "2026-08-10" }),
    });
    const scheduled = task.scheduled ?? null;
    const due = task.due ?? null;

    await store.dispatch({
      type: "update",
      taskId: task.id,
      payload: { title: "Renamed", due, scheduled },
    });
    await expect(
      store.getPendingCompletionRestore(task.id, OCCURRENCE_DATE),
    ).resolves.toEqual(restore);

    const edit = queue.head();
    if (edit?.type !== "update") throw new Error("expected edit command");
    await store.applyServerAck(edit, { ...task, title: "Renamed" });
    await expect(
      store.getPendingCompletionRestore(task.id, OCCURRENCE_DATE),
    ).resolves.toEqual(restore);
  });

  test("treats null and undefined schedule fields as unchanged", async () => {
    const task = makeTask({ recurrence: "FREQ=WEEKLY" });
    const { store, queue, restore } = await acknowledgedCompletion({
      task,
    });

    await store.dispatch({
      type: "update",
      taskId: task.id,
      payload: { title: "Renamed", due: null, scheduled: null },
    });
    await expect(
      store.getPendingCompletionRestore(task.id, OCCURRENCE_DATE),
    ).resolves.toEqual(restore);

    const edit = queue.head();
    if (edit?.type !== "update") throw new Error("expected edit command");
    await store.applyServerAck(edit, { ...task, title: "Renamed" });
    await expect(
      store.getPendingCompletionRestore(task.id, OCCURRENCE_DATE),
    ).resolves.toEqual(restore);
  });

  test("retains a restore when a later occurrence edit is dead-lettered", async () => {
    const { store, queue, restore, task } = await acknowledgedCompletion();

    await store.dispatch({
      type: "update",
      taskId: task.id,
      payload: { recurrence: "FREQ=MONTHLY" },
    });
    const edit = queue.head();
    if (edit?.type !== "update") throw new Error("expected edit command");
    await store.deadLetterCommand(edit.id, new ApiError("invalid", 422));

    await expect(
      store.getPendingCompletionRestore(task.id, OCCURRENCE_DATE),
    ).resolves.toEqual(restore);
  });
});

describe("TaskStore restore durability", () => {
  test("persists an acked occurrence edit's invalidation before the base that makes it stale", async () => {
    // Every other pair of writes in `applyServerAck` survives a crash between
    // them because the command is still queued and the resend repairs it. This
    // pair does not: whether an ack invalidates is decided by comparing its
    // payload against the *durable* base, so once that base holds the edit the
    // resent command reads as touching nothing, and the snapshot the edit made
    // false lives on to rewind a schedule the user already replaced. So the
    // interruption is the test — the restore write that follows the base write
    // is refused, and the relaunch is asked what an undo would now send.
    const task = makeTask({
      recurrence: "FREQ=WEEKLY",
      scheduled: "2026-08-08",
    });
    const backingStorage = memoryStoreStorage({ tasks: [task] });
    let writes: string[] = [];
    let refuseRestoresAfterBase = false;
    const storeStorage: MemoryStoreStorage = {
      ...backingStorage,
      setTasks: async (tasks) => {
        writes.push("tasks");
        await backingStorage.setTasks(tasks);
      },
      setAcknowledgedCompletionRestores: async (data) => {
        if (refuseRestoresAfterBase && writes.includes("tasks")) {
          throw new Error("the acknowledged restores are not writable");
        }
        writes.push("restores");
        await backingStorage.setAcknowledgedCompletionRestores(data);
      },
    };
    const { store, queue, queueStorage } = makeStore(
      memoryQueueStorage(),
      storeStorage,
    );
    await store.restore();
    const restore = {
      scheduled: "2026-08-08",
      due: null,
      recurrence: "FREQ=WEEKLY",
      skipped: false,
    };
    await store.dispatch({
      type: "set_instance_complete",
      taskId: task.id,
      date: "2026-08-08",
      completed: true,
      restore,
    });
    const completion = queue.head();
    if (completion?.type !== "set_instance_complete") {
      throw new Error("expected completion command");
    }
    await store.applyServerAck(completion, {
      ...task,
      completeInstances: ["2026-08-08"],
      scheduled: "2026-08-15",
    });

    await store.dispatch({
      type: "update",
      taskId: task.id,
      payload: { scheduled: "2026-08-22" },
    });
    const edit = queue.head();
    if (edit?.type !== "update") throw new Error("expected edit command");

    writes = [];
    refuseRestoresAfterBase = true;
    await expect(
      store.applyServerAck(edit, { ...task, scheduled: "2026-08-22" }),
    ).rejects.toThrow("not writable");
    expect(writes).toEqual(["restores", "tasks"]);

    refuseRestoresAfterBase = false;
    const { store: reborn } = makeStore(
      queueStorage.clone(),
      backingStorage.clone(),
    );
    await reborn.restore();
    expect(
      await reborn.getPendingCompletionRestore(task.id, "2026-08-08"),
    ).toBeUndefined();
  });
});

describe("TaskStore pending restores", () => {
  test("reads a pending restore after an in-flight create remaps its id", async () => {
    const backingStorage = memoryStoreStorage();
    const aliasWriteStarted = Promise.withResolvers<null>();
    const releaseAliasWrite = Promise.withResolvers<null>();
    const storeStorage: MemoryStoreStorage = {
      ...backingStorage,
      setIdAliases: async (data) => {
        aliasWriteStarted.resolve(null);
        await releaseAliasWrite.promise;
        await backingStorage.setIdAliases(data);
      },
    };
    const { store, queue } = makeStore(memoryQueueStorage(), storeStorage);
    await store.restore();
    const optimistic = await store.dispatch({
      type: "create",
      payload: { title: "New" },
    });
    if (optimistic === undefined) throw new Error("expected optimistic task");
    const restore = {
      scheduled: "2026-08-08",
      due: null,
      recurrence: "FREQ=WEEKLY",
      skipped: false,
    };
    await store.dispatch({
      type: "set_instance_complete",
      taskId: optimistic.id,
      date: "2026-08-08",
      completed: true,
      restore,
    });
    const createCmd = queue.head();
    if (createCmd?.type !== "create") throw new Error("expected create head");
    const real = makeTask({ id: taskId("TaskNotes/New.md"), title: "New" });

    const ack = store.applyServerAck(createCmd, real);
    await aliasWriteStarted.promise;
    const pendingRestore = store.getPendingCompletionRestore(
      optimistic.id,
      "2026-08-08",
    );
    releaseAliasWrite.resolve(null);

    await ack;
    await expect(pendingRestore).resolves.toEqual(restore);
  });

  test("retains a restore while its completion acknowledgement is settling", async () => {
    const backingStorage = memoryStoreStorage();
    const ackWriteStarted = Promise.withResolvers<null>();
    const releaseAckWrite = Promise.withResolvers<null>();
    let pauseAckWrite = false;
    const storeStorage: MemoryStoreStorage = {
      ...backingStorage,
      setTasks: async (tasks) => {
        if (pauseAckWrite) {
          pauseAckWrite = false;
          ackWriteStarted.resolve(null);
          await releaseAckWrite.promise;
        }
        await backingStorage.setTasks(tasks);
      },
    };
    const task = makeTask({
      recurrence: "FREQ=WEEKLY",
      scheduled: "2026-08-08",
    });
    const { queue } = makeStore(
      memoryQueueStorage(),
      memoryStoreStorage({ tasks: [task] }),
    );
    const storeWithPausedAck = new TaskStore(queue, storeStorage, clock);
    await storeWithPausedAck.restore();
    const restore = {
      scheduled: "2026-08-08",
      due: null,
      recurrence: "FREQ=WEEKLY",
      skipped: false,
    };
    await storeWithPausedAck.dispatch({
      type: "set_instance_complete",
      taskId: task.id,
      date: "2026-08-08",
      completed: true,
      restore,
    });
    const command = queue.head();
    if (command?.type !== "set_instance_complete") {
      throw new Error("expected completion command");
    }

    pauseAckWrite = true;
    const ack = storeWithPausedAck.applyServerAck(command, {
      ...task,
      completeInstances: ["2026-08-08"],
    });
    await ackWriteStarted.promise;
    const pendingRestore = storeWithPausedAck.getPendingCompletionRestore(
      task.id,
      "2026-08-08",
    );
    releaseAckWrite.resolve(null);

    await ack;
    await expect(pendingRestore).resolves.toEqual(restore);
  });

  test("persists an acknowledged restore across relaunch", async () => {
    const queueStorage = memoryQueueStorage();
    const task = recurringTask();
    const storeStorage = memoryStoreStorage({ tasks: [task] });
    const { restore } = await acknowledgedCompletion({
      queueStorage,
      storeStorage,
      task,
    });

    const relaunchedQueue = new CommandQueue(queueStorage.clone(), clock);
    const relaunched = new TaskStore(
      relaunchedQueue,
      storeStorage.clone(),
      clock,
    );
    await relaunched.restore();
    await expect(
      relaunched.getPendingCompletionRestore(task.id, OCCURRENCE_DATE),
    ).resolves.toEqual(restore);
  });

  test("invalidates an acknowledged restore after recurrence edits", async () => {
    const { store, queue, task } = await acknowledgedCompletion();

    await store.dispatch({
      type: "update",
      taskId: task.id,
      payload: { recurrence: "FREQ=MONTHLY" },
    });
    await expect(
      store.getPendingCompletionRestore(task.id, OCCURRENCE_DATE),
    ).resolves.toEqual(undefined);
    const updateCommand = queue.head();
    if (updateCommand?.type !== "update") {
      throw new Error("expected update command");
    }
    await store.applyServerAck(updateCommand, {
      ...task,
      recurrence: "FREQ=MONTHLY",
      completeInstances: [],
    });

    await expect(
      store.getPendingCompletionRestore(task.id, OCCURRENCE_DATE),
    ).resolves.toEqual(undefined);
  });
});

describe("TaskStore restore expiry", () => {
  test("prunes acknowledged restores after their occurrence day", async () => {
    const { store, storeStorage, task } = await acknowledgedCompletion();
    now = Date.parse("2026-08-09T12:00:00.000Z");

    await expect(
      store.getPendingCompletionRestore(task.id, OCCURRENCE_DATE),
    ).resolves.toEqual(undefined);
    expect(await storeStorage.getAcknowledgedCompletionRestores()).toBe("{}");
  });
});

describe("TaskStore server acks", () => {
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

  test("keeps an acknowledged command durable until its base write succeeds", async () => {
    const seeded = makeTask();
    const queueStorage = memoryQueueStorage();
    const backingStorage = memoryStoreStorage({ tasks: [seeded] });
    const storeStorage: MemoryStoreStorage = {
      ...backingStorage,
      setTasks: () => Promise.reject(new Error("base write interrupted")),
    };
    const { store, queue } = makeStore(queueStorage, storeStorage);
    await store.restore();
    await store.dispatch({
      type: "update",
      taskId: seeded.id,
      payload: { title: "Durable rename" },
    });
    const command = queue.head();
    if (command === undefined) throw new Error("expected queued update");

    await expect(
      store.applyServerAck(command, { ...seeded, title: "Durable rename" }),
    ).rejects.toThrow("base write interrupted");
    expect(queue.pending.map((pending) => pending.id)).toEqual([command.id]);

    const relaunched = makeStore(
      queueStorage.clone(),
      backingStorage.clone(),
    ).store;
    await relaunched.restore();
    expect(relaunched.getSnapshot().pendingCount).toBe(1);
    expect(relaunched.getSnapshot().tasks.get(seeded.id)?.title).toBe(
      "Durable rename",
    );
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

describe("TaskStore id minting", () => {
  test("the counters are durable, and dispatch persists them before enqueuing", async () => {
    const { store, storeStorage, queueStorage } = makeStore();
    await store.restore();
    await store.dispatch({ type: "create", payload: { title: "One" } });

    expect(JSON.parse((await storeStorage.getIdCounters()) ?? "null")).toEqual({
      command: 1,
      temp: 1,
    });
    // Ordering matters: a crash between the two writes must lose the command,
    // never resurrect its id. The queue write is the later of the two.
    expect(await queueStorage.readQueue()).not.toBeNull();
  });

  test("a relaunch inside one clock millisecond mints fresh ids", async () => {
    // No clock advance anywhere in this test — that is the whole point. The
    // command id doubles as X-Mutation-Id, so re-minting a live one makes the
    // server answer the second command from the first one's stored response.
    const { store, queueStorage, storeStorage } = makeStore();
    await store.restore();
    await store.dispatch({ type: "create", payload: { title: "Before" } });

    const { store: reborn, queue: rebornQueue } = makeStore(
      queueStorage.clone(),
      storeStorage.clone(),
    );
    await reborn.restore();
    await reborn.dispatch({ type: "create", payload: { title: "After" } });

    expect(rebornQueue.pending).toHaveLength(2);
    expect(new Set(commandIds(rebornQueue)).size).toBe(2);
    expect(new Set(tempIds(rebornQueue)).size).toBe(2);
  });

  test("an install with no persisted counters still cannot re-mint a queued id", async () => {
    // The upgrade path: durable queue carried over from a build that never
    // wrote `id_counters`, so the counters restore as zero. No schema
    // migration covers this — the mint-and-check loop does.
    const { store, queueStorage } = makeStore();
    await store.restore();
    await store.dispatch({ type: "create", payload: { title: "Before" } });

    const { store: reborn, queue: rebornQueue } = makeStore(
      queueStorage.clone(),
      memoryStoreStorage(), // no counters key at all
    );
    await reborn.restore();
    await reborn.dispatch({ type: "create", payload: { title: "After" } });

    expect(new Set(commandIds(rebornQueue)).size).toBe(2);
    expect(new Set(tempIds(rebornQueue)).size).toBe(2);
  });

  test("a dead-lettered command still reserves its id", async () => {
    const { store, queue, queueStorage } = makeStore();
    await store.restore();
    await store.dispatch({ type: "create", payload: { title: "Parked" } });
    const parked = queue.head();
    if (parked === undefined) throw new Error("expected a queued command");
    await store.deadLetterCommand(parked.id, new ApiError("bad request", 422));
    expect(queue.deadLetters).toHaveLength(1);

    // Relaunch with the counters wiped: the only thing standing between the
    // new command and the parked one's id is the dead-letter check. A parked
    // command can still be retried, so its id is still live server-side.
    const { store: reborn, queue: rebornQueue } = makeStore(
      queueStorage.clone(),
      memoryStoreStorage(),
    );
    await reborn.restore();
    await reborn.dispatch({ type: "create", payload: { title: "Fresh" } });

    const fresh = rebornQueue.head();
    if (fresh === undefined) throw new Error("expected a queued command");
    expect(fresh.id).not.toBe(parked.id);
  });
});
