import { describe, expect, test } from "vitest";

import { ApiError } from "../../../domain/errors";
import { FakeServer, makeClock, makeHarness, makeTask } from "./harness";

/**
 * Crash-safety for recurring mutations — the cases from the fix that made a
 * recurring completion survive an offline replay without losing the schedule
 * it captured.
 *
 * ## Why these are TypeScript and not JSON scenarios
 *
 * `harness.test.ts` and `offline-scenarios.test.ts` are now thin loaders over
 * the language-neutral corpus in `packages/tasknotes-fixtures`, so the Rust
 * core runs the identical stories. These five arrived on `main` *after* that
 * conversion and have no fixture equivalent, so they were silently dropped
 * when the two branches met — five tests covering a shipped data-loss fix,
 * removed by a merge that looked clean. They are restored here verbatim rather
 * than paraphrased into fixtures, because a rewrite is a new test and the
 * point was to keep exactly the coverage that existed.
 *
 * ⚠️ They are therefore TS-only: the Rust core does **not** check them. Porting
 * them into the corpus is tracked in
 * This should move into the shared language-neutral fixture corpus.
 */

describe("FakeServer recurring restore semantics", () => {
  test("stale recurring restores return a conflict without overwriting edits", async () => {
    const server = new FakeServer(makeClock());
    const recurring = makeTask({
      recurrence: "DTSTART:20260801;FREQ=WEEKLY",
      scheduled: "2026-08-08",
      due: "2026-08-10",
      completeInstances: ["2026-08-01"],
    });
    server.seed(recurring);
    server.injectServerEdit(recurring.id, {
      scheduled: "2026-08-15",
      due: "2026-08-17",
    });

    const result = await server.completeRecurringInstance(recurring.id, {
      date: "2026-08-01",
      completed: false,
      restore: {
        recurrence: "DTSTART:20260801;FREQ=WEEKLY",
        scheduled: "2026-08-08",
        due: "2026-08-10",
        skipped: false,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(ApiError);
    if (!result.ok && result.error instanceof ApiError) {
      // `statusCode` on `main`; renamed to `status` by the tagged-error-kinds
      // change on this branch. Same assertion, current spelling.
      expect(result.error.status).toBe(409);
    }
    expect(server.tasks.get(recurring.id)?.scheduled).toBe("2026-08-15");
    expect(server.tasks.get(recurring.id)?.due).toBe("2026-08-17");
  });

  test("already-restored recurring state is idempotent", async () => {
    const server = new FakeServer(makeClock());
    const recurring = makeTask({
      recurrence: "DTSTART:20260801;FREQ=WEEKLY",
      scheduled: "2026-08-08",
      due: "2026-08-10",
    });
    server.seed(recurring);

    const result = await server.completeRecurringInstance(recurring.id, {
      date: "2026-08-01",
      completed: false,
      restore: {
        recurrence: "DTSTART:20260801;FREQ=WEEKLY",
        scheduled: "2026-08-08",
        due: "2026-08-10",
        skipped: false,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scheduled).toBe("2026-08-08");
      expect(result.value.due).toBe("2026-08-10");
      expect(result.value.completeInstances).toEqual([]);
    }
  });
});

describe("recurring completion captures the tapped day", () => {
  test("offline completion advances the projected schedule", async () => {
    const harness = makeHarness();
    harness.clock.set(new Date("2026-08-03T12:00:00.000Z").getTime());
    await harness.store.restore();
    const recurring = makeTask({
      recurrence: "FREQ=WEEKLY",
      scheduled: "2026-08-01",
    });
    harness.server.seed(recurring);
    await harness.engine.syncNow();

    await harness.store.dispatch({
      type: "set_instance_complete",
      taskId: recurring.id,
      date: "2026-08-01",
      completed: true,
    });
    const result = await harness.engine.syncNow();

    expect(result.ok).toBe(true);
    expect(harness.server.tasks.get(recurring.id)?.scheduled).toBe(
      "2026-08-08",
    );
  });

  test("atomic Undo survives an offline replay with the original schedule", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    const recurring = makeTask({
      recurrence: "DTSTART:20260801;FREQ=WEEKLY",
      scheduled: "2026-08-08",
      completeInstances: ["2026-08-01"],
    });
    harness.server.seed(recurring);
    const initialSync = await harness.engine.syncNow();
    expect(initialSync.ok).toBe(true);
    harness.server.goOffline();

    await harness.store.dispatch({
      type: "set_instance_complete",
      taskId: recurring.id,
      date: "2026-08-01",
      completed: false,
      restore: {
        recurrence: "DTSTART:20260801;FREQ=WEEKLY",
        scheduled: "2026-08-01",
        due: null,
        skipped: false,
      },
    });

    const optimistic = harness.store.getSnapshot().tasks.get(recurring.id);
    expect(optimistic?.completeInstances).toEqual([]);
    expect(optimistic?.scheduled).toBe("2026-08-01");
    expect(optimistic?.due).toBeUndefined();

    harness.server.goOnline();
    const syncResult = await harness.engine.syncNow();
    expect(syncResult.ok).toBe(true);
    const server = harness.server.tasks.get(recurring.id);
    expect(server?.completeInstances).toEqual([]);
    expect(server?.scheduled).toBe("2026-08-01");
    expect(server?.due).toBeUndefined();
  });

  test("offline re-toggle preserves the pending completion restore", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    const recurring = makeTask({
      recurrence: "DTSTART:20260801;FREQ=WEEKLY",
      scheduled: "2026-08-08",
      due: "2026-08-10",
    });
    harness.server.seed(recurring);
    const initialSync = await harness.engine.syncNow();
    expect(initialSync.ok).toBe(true);
    harness.server.goOffline();

    const restore = {
      recurrence: "DTSTART:20260801;FREQ=WEEKLY",
      scheduled: "2026-08-08",
      due: "2026-08-10",
      skipped: false,
    };
    await harness.store.dispatch({
      type: "set_instance_complete",
      taskId: recurring.id,
      date: "2026-08-08",
      completed: true,
      restore,
    });
    await harness.store.dispatch({
      type: "set_instance_complete",
      taskId: recurring.id,
      date: "2026-08-08",
      completed: false,
      restore,
    });

    harness.server.goOnline();
    const syncResult = await harness.engine.syncNow();
    expect(syncResult.ok).toBe(true);
    const completionCalls = harness.server.calls.filter(
      (call) => call.method === "completeRecurringInstance",
    );
    expect(completionCalls).toHaveLength(2);
    expect(completionCalls[0]?.payload).toEqual({
      date: "2026-08-08",
      completed: true,
    });
    expect(completionCalls[1]?.payload).toEqual({
      date: "2026-08-08",
      completed: false,
      restore,
    });
    expect(harness.server.tasks.get(recurring.id)?.scheduled).toBe(
      "2026-08-08",
    );
  });
});
