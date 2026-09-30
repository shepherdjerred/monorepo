import { describe, expect, test } from "vitest";
import type { ScoutTemporalQueueClass } from "#src/configuration/runtime-role.ts";
import {
  awaitWorkerExitOrShutdown,
  sameQueueClasses,
} from "#src/temporal/supervisor.ts";

/** A promise that never settles, standing in for "no shutdown yet". */
function neverClosed(): Promise<undefined> {
  return new Promise<undefined>(() => {
    // Deliberately never resolved.
  });
}

function queues(
  ...classes: ScoutTemporalQueueClass[]
): ReadonlySet<ScoutTemporalQueueClass> {
  return new Set(classes);
}

describe("worker-set comparison", () => {
  test("order does not matter", () => {
    expect(
      sameQueueClasses(queues("workflow", "lake"), queues("lake", "workflow")),
    ).toBe(true);
  });

  test("a widened set is a different set", () => {
    // This is what makes `enableDeferredWorkers` rebuild rather than keep
    // polling the narrower set it connected with.
    expect(
      sameQueueClasses(queues("workflow"), queues("workflow", "background")),
    ).toBe(false);
  });

  test("two empty sets match", () => {
    expect(sameQueueClasses(queues(), queues())).toBe(true);
  });
});

describe("connection hold", () => {
  test("returns when a worker's run promise settles", async () => {
    const stopped = Promise.resolve();
    await expect(
      awaitWorkerExitOrShutdown([stopped], neverClosed()),
    ).resolves.toBeUndefined();
  });

  test("a worker-less role still returns on shutdown", async () => {
    // The `gateway` role runs a Temporal client and no workers. Racing an empty
    // array would never settle, which would wedge the connect loop — and
    // `shutdown()` awaits that loop, so the process would never exit either.
    const closed = Promise.withResolvers<undefined>();
    let returned = false;
    const held = (async () => {
      await awaitWorkerExitOrShutdown([], closed.promise);
      returned = true;
    })();

    await Bun.sleep(5);
    expect(returned).toBe(false);

    closed.resolve(undefined);
    await held;
    expect(returned).toBe(true);
  });

  test("a rejected worker run propagates rather than hanging", async () => {
    const failed = Promise.reject(new Error("worker crashed"));
    await expect(
      awaitWorkerExitOrShutdown([failed], neverClosed()),
    ).rejects.toThrow("worker crashed");
  });
});
