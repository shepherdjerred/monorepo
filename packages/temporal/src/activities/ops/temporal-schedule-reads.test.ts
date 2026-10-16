import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, test } from "vitest";
import { withScheduleReads } from "./temporal-schedule-reads.ts";

describe("shared Temporal schedule read budget", () => {
  test("a slot released by prod retains the queued beta RPC context", async () => {
    const context = new AsyncLocalStorage<string>();
    const gate = Promise.withResolvers<undefined>();
    await withScheduleReads(async ({ read }) => {
      const prod = context.run("prod", () =>
        Array.from({ length: 8 }, () =>
          read(async () => {
            await gate.promise;
            return context.getStore();
          }),
        ),
      );
      const beta = context.run("beta", () =>
        read(async () => {
          await Promise.resolve();
          return context.getStore();
        }),
      );
      gate.resolve(undefined);
      expect(await beta).toBe("beta");
      expect(await Promise.all(prod)).toEqual(
        Array.from({ length: 8 }, () => "prod"),
      );
    });
  });
  test("never starts more than eight reads across competing callers", async () => {
    let active = 0;
    let maximum = 0;
    const gate = Promise.withResolvers<undefined>();
    await withScheduleReads(async ({ read }) => {
      const reads = Array.from({ length: 40 }, (_, index) =>
        read(async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await gate.promise;
          active -= 1;
          return index;
        }),
      );
      await Promise.resolve();
      expect(active).toBe(8);
      gate.resolve(undefined);
      expect(await Promise.all(reads)).toEqual(
        Array.from({ length: 40 }, (_, index) => index),
      );
    });
    expect(maximum).toBe(8);
  });

  test("cancellation rejects active reads and prevents queued reads from starting", async () => {
    const controller = new AbortController();
    let started = 0;
    const reason = new Error("activity cancelled");
    const result = withScheduleReads(
      async ({ read }) => {
        const reads = Array.from({ length: 12 }, () =>
          read(async () => {
            started += 1;
            return await Promise.withResolvers<undefined>().promise;
          }),
        );
        await Promise.resolve();
        controller.abort(reason);
        await Promise.all(reads);
      },
      { signal: controller.signal },
    );
    await expect(result).rejects.toBe(reason);
    expect(started).toBe(8);
  });

  test("the deadline fails a stuck read before the Activity timeout", async () => {
    await expect(
      withScheduleReads(
        async ({ read }) =>
          await read(() => Promise.withResolvers<undefined>().promise),
        { timeoutMs: 10 },
      ),
    ).rejects.toHaveProperty("name", "TimeoutError");
  });

  test("a failed read frees its slot and does not turn into a healthy result", async () => {
    const error = new Error("read denied");
    await expect(
      withScheduleReads(async ({ read }) => {
        await read(() => {
          throw error;
        });
      }),
    ).rejects.toBe(error);
  });
});
