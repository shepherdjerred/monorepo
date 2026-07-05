import { describe, expect, test } from "bun:test";

import { NetworkError } from "../../../domain/errors";
import { taskId } from "../../../domain/types";
import { MutationQueue } from "../MutationQueue";
import {
  FakeServer,
  MemoryMutationStorage,
  makeClock,
  makeHarness,
  makeTask,
} from "./harness";

describe("FakeServer", () => {
  test("offline mode fails every call with ConnectionError", async () => {
    const server = new FakeServer(makeClock());
    server.seed(makeTask());
    server.goOffline();

    const list = await server.listTasks();
    const create = await server.createTask({ title: "x" });
    expect(list.ok).toBe(false);
    expect(create.ok).toBe(false);
    if (!list.ok) expect(list.error.name).toBe("ConnectionError");
    if (!create.ok) expect(create.error.name).toBe("ConnectionError");

    server.goOnline();
    const listAgain = await server.listTasks();
    expect(listAgain.ok).toBe(true);
  });

  test("failNext injects a one-shot failure for the matched method only", async () => {
    const server = new FakeServer(makeClock());
    const seeded = makeTask();
    server.seed(seeded);
    server.failNext("updateTask", new NetworkError("boom"));

    const list = await server.listTasks();
    expect(list.ok).toBe(true);

    const first = await server.updateTask(seeded.id, { title: "New" });
    expect(first.ok).toBe(false);

    const second = await server.updateTask(seeded.id, { title: "New" });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.title).toBe("New");
  });

  test("unknown task ids return NotFoundError", async () => {
    const server = new FakeServer(makeClock());
    const result = await server.updateTask(taskId("TaskNotes/nope.md"), {
      title: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe("NotFoundError");
  });

  test("injectServerEdit simulates a concurrent Obsidian edit", async () => {
    const server = new FakeServer(makeClock());
    const seeded = makeTask({ title: "Original" });
    server.seed(seeded);
    server.injectServerEdit(seeded.id, { title: "Edited in Obsidian" });

    const list = await server.listTasks();
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value[0]?.title).toBe("Edited in Obsidian");
  });

  test("completeRecurringInstance toggles clock-today (current server contract)", async () => {
    const clock = makeClock(new Date("2026-07-03T12:00:00").getTime());
    const server = new FakeServer(clock);
    const seeded = makeTask({ recurrence: "FREQ=DAILY" });
    server.seed(seeded);

    const first = await server.completeRecurringInstance(seeded.id);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.completeInstances).toEqual(["2026-07-03"]);

    const second = await server.completeRecurringInstance(seeded.id);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.completeInstances).toEqual([]);
  });

  test("call log records every call including failed and offline ones", async () => {
    const server = new FakeServer(makeClock());
    server.goOffline();
    await server.listTasks();
    server.goOnline();
    await server.createTask({ title: "a" });
    expect(server.callCount("listTasks")).toBe(1);
    expect(server.callCount("createTask")).toBe(1);
    expect(server.calls.map((c) => c.method)).toEqual([
      "listTasks",
      "createTask",
    ]);
  });
});

async function deterministicScenario() {
  const harness = makeHarness();
  harness.clock.advance(1000);
  const first = await harness.queue.enqueue({
    type: "delete",
    taskId: taskId("TaskNotes/a.md"),
  });
  harness.clock.advance(500);
  const second = await harness.queue.enqueue({
    type: "toggle_status",
    taskId: taskId("TaskNotes/b.md"),
    payload: { status: "done" },
  });
  return [first, second];
}

describe("harness determinism", () => {
  test("same scenario produces identical mutation ids and timestamps", async () => {
    expect(await deterministicScenario()).toEqual(
      await deterministicScenario(),
    );
  });
});

describe("crash simulation via storage snapshot", () => {
  test("queue rebuilt from a snapshot restores pending mutations verbatim", async () => {
    const harness = makeHarness();
    harness.server.goOffline();
    await harness.queue.enqueue({
      type: "update",
      taskId: taskId("TaskNotes/a.md"),
      payload: { title: "Renamed offline" },
    });
    await harness.queue.enqueue({
      type: "delete",
      taskId: taskId("TaskNotes/b.md"),
    });
    const before = [...harness.queue.pending];

    // Simulated crash: only durable state survives.
    const relaunched = new MutationQueue(
      MemoryMutationStorage.fromSnapshot(harness.storage.snapshot()),
      harness.clock.now,
    );
    await relaunched.restore();

    expect(relaunched.pending).toEqual(before);
  });
});

describe("fullSync over the harness (current engine behavior)", () => {
  test("drains the queue, pulls, caches, and stamps lastSyncTime from the clock", async () => {
    const harness = makeHarness();
    const seeded = makeTask();
    harness.server.seed(seeded);
    await harness.queue.enqueue({
      type: "update",
      taskId: seeded.id,
      payload: { priority: "high" },
    });

    harness.clock.set(1_750_000_123_000);
    const result = await harness.engine.fullSync();

    expect(result.ok).toBe(true);
    expect(harness.server.callCount("updateTask")).toBe(1);
    expect(harness.server.callCount("listTasks")).toBe(1);
    expect(harness.queue.isEmpty).toBe(true);
    expect(harness.tasksSeen()[0]?.priority).toBe("high");
    expect(harness.cache.snapshotTasks()[0]?.priority).toBe("high");
    expect(await harness.cache.getLastSyncTime()).toBe(1_750_000_123_000);
  });

  test("offline fullSync fails and leaves the queue intact", async () => {
    const harness = makeHarness();
    harness.server.goOffline();
    await harness.queue.enqueue({
      type: "delete",
      taskId: taskId("TaskNotes/a.md"),
    });

    const result = await harness.engine.fullSync();

    expect(result.ok).toBe(false);
    expect(harness.queue.pending).toHaveLength(1);
  });
});
