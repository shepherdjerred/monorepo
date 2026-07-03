import { describe, expect, test } from "bun:test";

import { ApiError } from "../../../domain/errors";
import { taskId } from "../../../domain/types";
import { makeHarness, makeTask } from "./harness";

/**
 * End-to-end scenarios over the deterministic harness. Each test tells one
 * story from the 2026-07-02 system review — the situations the old sync
 * layer lost data in.
 */

describe("subway mode (fully offline session)", () => {
  test("offline dispatches survive a relaunch and converge once online", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    const seeded = makeTask();
    harness.server.seed(seeded);
    // Normal online use first — the seeded task lands in the local base.
    const initial = await harness.engine.syncNow();
    expect(initial.ok).toBe(true);
    harness.server.goOffline();

    // Offline: create a task, rename the seeded one, complete it.
    const optimistic = await harness.store.dispatch({
      type: "create",
      payload: { title: "Written underground" },
    });
    if (optimistic === undefined) throw new Error("expected optimistic task");
    await harness.store.dispatch({
      type: "update",
      taskId: seeded.id,
      payload: { title: "Renamed offline" },
    });
    await harness.store.dispatch({
      type: "set_status",
      taskId: seeded.id,
      status: "done",
    });
    const attempt = await harness.engine.syncNow();
    expect(attempt.ok).toBe(false); // offline — queue intact
    const beforeCrash = harness.store.getSnapshot();
    expect(beforeCrash.tasks.get(optimistic.id)?.title).toBe(
      "Written underground",
    );
    expect(beforeCrash.tasks.get(seeded.id)?.status).toBe("done");

    // App killed on the subway; relaunch from durable state only.
    const relaunched = makeHarness({
      clock: harness.clock,
      server: harness.server,
      queueStorage: harness.queueStorage.clone(),
      storeStorage: harness.storeStorage.clone(),
    });
    await relaunched.store.restore();
    const afterRelaunch = relaunched.store.getSnapshot();
    expect(afterRelaunch.pendingCount).toBe(beforeCrash.pendingCount);
    expect(afterRelaunch.tasks.size).toBe(beforeCrash.tasks.size);
    expect(afterRelaunch.tasks.get(seeded.id)?.title).toBe("Renamed offline");

    // Back above ground.
    harness.server.goOnline();
    const result = await relaunched.engine.syncNow();
    expect(result.ok).toBe(true);
    expect(relaunched.queue.isEmpty).toBe(true);
    const server = [...harness.server.tasks.values()];
    expect(server).toHaveLength(2);
    expect(server.find((t) => t.title === "Written underground")).toBeDefined();
    expect(server.find((t) => t.id === seeded.id)?.status).toBe("done");
  });
});

describe("reconnect delivers each mutation exactly once", () => {
  test("multiple triggers cannot double-execute a queued command", async () => {
    const harness = makeHarness({ autoSync: true });
    await harness.store.restore();
    const seeded = makeTask();
    harness.server.seed(seeded);
    harness.server.goOffline();

    // autoSync fires on dispatch and fails; a retry gets scheduled.
    await harness.store.dispatch({
      type: "set_status",
      taskId: seeded.id,
      status: "done",
    });
    await harness.engine.syncNow(); // pull-to-refresh while offline
    expect(harness.engine.getStatus().state).toBe("backoff");

    harness.server.goOnline();
    // Reconnect: the retry timer, a foreground trigger, and a manual sync
    // all land at once — the exact pile-up that used to replay the queue.
    harness.scheduler.fireNext();
    harness.engine.requestSync();
    await harness.engine.syncNow();

    expect(harness.server.applyCount("toggleTaskStatus")).toBe(1);
    expect(harness.queue.isEmpty).toBe(true);
    expect(harness.server.tasks.get(seeded.id)?.status).toBe("done");
  });

  test("concurrent syncNow calls coalesce into the same run", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    harness.server.seed(makeTask());

    const [a, b] = await Promise.all([
      harness.engine.syncNow(),
      harness.engine.syncNow(),
    ]);
    expect(a.ok).toBe(true);
    // The joined caller receives the very same settled result object.
    expect(b).toBe(a);
  });
});

describe("crash between server ack and client dequeue", () => {
  test("the replayed X-Mutation-Id is deduped — no duplicate task", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    await harness.store.dispatch({
      type: "create",
      payload: { title: "Exactly once" },
    });
    // Durable state as of *before* the sync: queue still holds the create.
    const staleQueue = harness.queueStorage.clone();
    const staleStore = harness.storeStorage.clone();

    const result = await harness.engine.syncNow();
    expect(result.ok).toBe(true);
    expect(harness.server.tasks.size).toBe(1);

    // Crash happened before the ack could persist; relaunch from stale state
    // against the same server.
    const relaunched = makeHarness({
      clock: harness.clock,
      server: harness.server,
      queueStorage: staleQueue,
      storeStorage: staleStore,
    });
    await relaunched.store.restore();
    expect(relaunched.queue.pending).toHaveLength(1); // the create is back

    const replay = await relaunched.engine.syncNow();
    expect(replay.ok).toBe(true);
    expect(harness.server.tasks.size).toBe(1); // deduped, not duplicated
    expect(harness.server.applyCount("createTask")).toBe(1);
    expect(harness.server.callCount("createTask")).toBe(2);
    expect(relaunched.store.getSnapshot().tasks.size).toBe(1);
  });
});

describe("temp-ID chain", () => {
  test("offline create + edits on the temp id all land on the real task", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    harness.server.goOffline();

    const optimistic = await harness.store.dispatch({
      type: "create",
      payload: { title: "Chained" },
    });
    if (optimistic === undefined) throw new Error("expected optimistic task");
    await harness.store.dispatch({
      type: "update",
      taskId: optimistic.id,
      payload: { priority: "high" },
    });
    await harness.store.dispatch({
      type: "set_status",
      taskId: optimistic.id,
      status: "done",
    });

    harness.server.goOnline();
    const result = await harness.engine.syncNow();
    expect(result.ok).toBe(true);

    const server = [...harness.server.tasks.values()];
    expect(server).toHaveLength(1);
    expect(server[0]?.title).toBe("Chained");
    expect(server[0]?.priority).toBe("high");
    expect(server[0]?.status).toBe("done");
    // The UI can still resolve the temp id it may be holding.
    const realId = harness.store.resolveTaskId(optimistic.id);
    expect(String(realId).startsWith("tmp-")).toBe(false);
    expect(harness.store.getSnapshot().tasks.get(realId)?.status).toBe("done");
  });
});

describe("conflict rebase (concurrent Obsidian edit)", () => {
  test("a field edited in Obsidian survives an offline edit to another field", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    const seeded = makeTask({ title: "Original", priority: "normal" });
    harness.server.seed(seeded);
    harness.server.goOffline();

    await harness.store.dispatch({
      type: "update",
      taskId: seeded.id,
      payload: { title: "Renamed on phone" },
    });
    // Meanwhile, on the desktop:
    harness.server.injectServerEdit(seeded.id, { priority: "high" });

    harness.server.goOnline();
    const result = await harness.engine.syncNow();
    expect(result.ok).toBe(true);

    const merged = harness.store.getSnapshot().tasks.get(seeded.id);
    expect(merged?.title).toBe("Renamed on phone");
    expect(merged?.priority).toBe("high");
  });
});

describe("retry classification", () => {
  test("transient 500 stops the drain, keeps order, and retries", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    const seeded = makeTask();
    harness.server.seed(seeded);

    await harness.store.dispatch({
      type: "update",
      taskId: seeded.id,
      payload: { title: "First" },
    });
    await harness.store.dispatch({
      type: "set_status",
      taskId: seeded.id,
      status: "done",
    });
    harness.server.failNext("updateTask", new ApiError("boom", 500));

    const attempt = await harness.engine.syncNow();
    expect(attempt.ok).toBe(false);
    // Nothing was skipped: the failed head is still first in line.
    expect(harness.queue.pending).toHaveLength(2);
    expect(harness.engine.getStatus().state).toBe("backoff");

    harness.scheduler.fireNext();
    const retried = await harness.engine.syncNow();
    expect(retried.ok).toBe(true);
    expect(harness.queue.isEmpty).toBe(true);
    expect(harness.server.tasks.get(seeded.id)?.title).toBe("First");
    expect(harness.server.tasks.get(seeded.id)?.status).toBe("done");
  });

  test("permanent 422 dead-letters the command and keeps draining", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    const seeded = makeTask();
    harness.server.seed(seeded);

    await harness.store.dispatch({
      type: "update",
      taskId: seeded.id,
      payload: { title: "Rejected" },
    });
    await harness.store.dispatch({
      type: "set_status",
      taskId: seeded.id,
      status: "done",
    });
    harness.server.failNext("updateTask", new ApiError("invalid", 422));

    const result = await harness.engine.syncNow();
    expect(result.ok).toBe(true); // the drain finished despite the rejection

    const snap = harness.store.getSnapshot();
    expect(snap.deadLetters).toHaveLength(1);
    expect(snap.deadLetters[0]?.error.status).toBe(422);
    // The rejected rename rolled back; the status change went through.
    expect(snap.tasks.get(seeded.id)?.title).toBe("Test");
    expect(snap.tasks.get(seeded.id)?.status).toBe("done");
  });

  test("404 on delete counts as success; 404 on update dead-letters", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    const ghost = taskId("TaskNotes/deleted-in-obsidian.md");

    await harness.store.dispatch({ type: "delete", taskId: ghost });
    await harness.store.dispatch({
      type: "update",
      taskId: taskId("TaskNotes/also-gone.md"),
      payload: { title: "x" },
    });

    const result = await harness.engine.syncNow();
    expect(result.ok).toBe(true);
    const snap = harness.store.getSnapshot();
    // Delete of an already-gone task: goal state reached, no dead letter.
    // Update of a vanished task: parked for review, not silently dropped.
    expect(snap.deadLetters).toHaveLength(1);
    expect(snap.deadLetters[0]?.command.type).toBe("update");
    expect(harness.queue.isEmpty).toBe(true);
  });

  test("401 stops the drain with auth status and schedules no retry", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    const seeded = makeTask();
    harness.server.seed(seeded);
    await harness.store.dispatch({
      type: "set_status",
      taskId: seeded.id,
      status: "done",
    });
    harness.server.failNext(
      "toggleTaskStatus",
      new ApiError("unauthorized", 401),
    );

    const result = await harness.engine.syncNow();
    expect(result.ok).toBe(false);
    expect(harness.engine.getStatus().state).toBe("auth_error");
    expect(harness.scheduler.pending()).toHaveLength(0);
    expect(harness.queue.pending).toHaveLength(1); // nothing lost

    // Token fixed (next trigger, e.g. settings save or health poll):
    const recovered = await harness.engine.syncNow();
    expect(recovered.ok).toBe(true);
    expect(harness.server.tasks.get(seeded.id)?.status).toBe("done");
  });

  test("backoff delay grows exponentially and is capped", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    harness.server.goOffline();
    await harness.store.dispatch({
      type: "delete",
      taskId: taskId("TaskNotes/a.md"),
    });

    const delays: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      await harness.engine.syncNow();
      const timer = harness.scheduler.pending().at(-1);
      if (timer === undefined) throw new Error("expected a retry timer");
      delays.push(timer.ms);
      harness.scheduler.fireNext();
    }
    // random() is pinned to 0.5 → jitter factor exactly 1.
    expect(delays).toEqual([
      1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000,
    ]);
  });
});

describe("recurring completion captures the tapped day", () => {
  test("a 23:59 tap replayed after midnight still completes the tapped date", async () => {
    const tappedAt = new Date("2026-07-01T23:59:00").getTime();
    const harness = makeHarness();
    harness.clock.set(tappedAt);
    await harness.store.restore();
    const recurring = makeTask({ recurrence: "FREQ=DAILY" });
    harness.server.seed(recurring);
    harness.server.goOffline();

    // The caller derives the date from the device-local tap time.
    await harness.store.dispatch({
      type: "set_instance_complete",
      taskId: recurring.id,
      date: "2026-07-01",
      completed: true,
    });

    // The phone reconnects the next morning.
    harness.clock.set(new Date("2026-07-02T08:00:00").getTime());
    harness.server.goOnline();
    const result = await harness.engine.syncNow();
    expect(result.ok).toBe(true);

    const server = harness.server.tasks.get(recurring.id);
    expect(server?.completeInstances).toEqual(["2026-07-01"]); // not 07-02
  });
});

describe("dead-letter review", () => {
  test("retry re-enqueues and syncs; discard drops it for good", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    const seeded = makeTask();
    harness.server.seed(seeded);
    await harness.store.dispatch({
      type: "update",
      taskId: seeded.id,
      payload: { title: "Flaky" },
    });
    harness.server.failNext("updateTask", new ApiError("invalid", 422));
    await harness.engine.syncNow();
    const dead = harness.store.getSnapshot().deadLetters[0];
    if (dead === undefined) throw new Error("expected a dead letter");

    // User taps Retry (the server accepts it this time).
    await harness.store.retryDeadLetter(dead.command.id);
    const result = await harness.engine.syncNow();
    expect(result.ok).toBe(true);
    expect(harness.server.tasks.get(seeded.id)?.title).toBe("Flaky");
    expect(harness.store.getSnapshot().deadLetters).toHaveLength(0);
  });
});
