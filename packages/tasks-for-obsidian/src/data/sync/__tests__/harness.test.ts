import { describe, expect, test } from "bun:test";

import { NetworkError } from "../../../domain/errors";
import { taskId } from "../../../domain/types";
import { CommandQueue } from "../CommandQueue";
import { FakeServer, makeClock, makeHarness, makeTask } from "./harness";

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

  test("completeRecurringInstance without a body toggles clock-today (legacy contract)", async () => {
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

  test("completeRecurringInstance with a body sets absolute state (P1 contract)", async () => {
    const server = new FakeServer(makeClock());
    const seeded = makeTask({ recurrence: "FREQ=DAILY" });
    server.seed(seeded);

    const set = await server.completeRecurringInstance(seeded.id, {
      date: "2026-07-01",
      completed: true,
    });
    expect(set.ok).toBe(true);
    if (set.ok) expect(set.value.completeInstances).toEqual(["2026-07-01"]);

    // Setting the same state again is a no-op, not a toggle.
    const again = await server.completeRecurringInstance(seeded.id, {
      date: "2026-07-01",
      completed: true,
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.completeInstances).toEqual(["2026-07-01"]);

    const unset = await server.completeRecurringInstance(seeded.id, {
      date: "2026-07-01",
      completed: false,
    });
    expect(unset.ok).toBe(true);
    if (unset.ok) expect(unset.value.completeInstances).toEqual([]);
  });

  test("a replayed X-Mutation-Id returns the stored response without re-applying", async () => {
    const server = new FakeServer(makeClock());
    const first = await server.createTask(
      { title: "Once" },
      { mutationId: "mut-1" },
    );
    const replay = await server.createTask(
      { title: "Once" },
      { mutationId: "mut-1" },
    );

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (first.ok && replay.ok) {
      expect(replay.value.id).toBe(first.value.id);
    }
    expect(server.tasks.size).toBe(1); // applied exactly once
    expect(server.callCount("createTask")).toBe(2); // but called twice
    expect(server.applyCount("createTask")).toBe(1);
    expect(server.calls[1]?.replayed).toBe(true);
  });

  test("call log records every call including failed and offline ones", async () => {
    const server = new FakeServer(makeClock());
    server.goOffline();
    await server.listTasks();
    server.goOnline();
    await server.createTask({ title: "a" }, { mutationId: "m1" });
    expect(server.callCount("listTasks")).toBe(1);
    expect(server.callCount("createTask")).toBe(1);
    expect(server.calls.map((c) => c.method)).toEqual([
      "listTasks",
      "createTask",
    ]);
    expect(server.calls[1]?.mutationId).toBe("m1");
  });
});

async function determinismScenario() {
  const harness = makeHarness();
  await harness.store.restore();
  harness.server.seed(makeTask());
  await harness.store.dispatch({ type: "create", payload: { title: "A" } });
  await harness.store.dispatch({
    type: "set_status",
    taskId: taskId("TaskNotes/test.md"),
    status: "done",
  });
  await harness.engine.syncNow();
  return {
    serverTasks: [...harness.server.tasks.entries()],
    view: [...harness.store.getSnapshot().tasks.entries()],
    pending: harness.store.getSnapshot().pendingCount,
  };
}

describe("harness determinism", () => {
  test("the same scenario converges to the identical end state", async () => {
    expect(await determinismScenario()).toEqual(await determinismScenario());
  });
});

describe("crash simulation via storage snapshot", () => {
  test("queue rebuilt from cloned storage restores pending commands verbatim", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    harness.server.goOffline();
    await harness.store.dispatch({
      type: "update",
      taskId: taskId("TaskNotes/a.md"),
      payload: { title: "Renamed offline" },
    });
    await harness.store.dispatch({
      type: "delete",
      taskId: taskId("TaskNotes/b.md"),
    });
    const before = [...harness.queue.pending];

    // Simulated crash: only durable state survives.
    const relaunched = new CommandQueue(
      harness.queueStorage.clone(),
      harness.clock.now,
    );
    await relaunched.restore();

    expect(relaunched.pending).toEqual(before);
  });
});

describe("sync over the harness", () => {
  test("drains the queue, pulls, caches, and stamps lastSyncTime from the clock", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    const seeded = makeTask();
    harness.server.seed(seeded);
    await harness.store.dispatch({
      type: "update",
      taskId: seeded.id,
      payload: { priority: "high" },
    });

    harness.clock.set(1_750_000_123_000);
    const result = await harness.engine.syncNow();

    expect(result.ok).toBe(true);
    expect(harness.server.callCount("updateTask")).toBe(1);
    expect(harness.server.callCount("listTasks")).toBe(1);
    expect(harness.queue.isEmpty).toBe(true);
    const snap = harness.store.getSnapshot();
    expect(snap.tasks.get(seeded.id)?.priority).toBe("high");
    expect(snap.lastSyncTime).toBe(1_750_000_123_000);
    expect(harness.engine.getStatus().state).toBe("idle");
  });

  test("offline sync fails, leaves the queue intact, and schedules a retry", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    harness.server.goOffline();
    await harness.store.dispatch({
      type: "delete",
      taskId: taskId("TaskNotes/a.md"),
    });

    const result = await harness.engine.syncNow();

    expect(result.ok).toBe(false);
    expect(harness.queue.pending).toHaveLength(1);
    expect(harness.engine.getStatus().state).toBe("backoff");
    expect(harness.scheduler.pending()).toHaveLength(1);
  });
});
