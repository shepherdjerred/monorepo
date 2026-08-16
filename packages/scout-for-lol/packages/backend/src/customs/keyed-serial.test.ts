import { describe, expect, test } from "bun:test";
import { createKeyedSerialExecutor } from "#src/customs/keyed-serial.ts";

describe("keyed serial executor", () => {
  test("runs operations for one night in invocation order", async () => {
    const runSerial = createKeyedSerialExecutor();
    const firstStarted = Promise.withResolvers<undefined>();
    const releaseFirst = Promise.withResolvers<undefined>();
    const events: string[] = [];
    const first = runSerial("night-1", async () => {
      events.push("first started");
      firstStarted.resolve(undefined);
      await releaseFirst.promise;
      events.push("first finished");
    });
    await firstStarted.promise;
    const second = runSerial("night-1", async () => {
      events.push("second started");
    });
    await Promise.resolve();
    expect(events).toEqual(["first started"]);

    releaseFirst.resolve(undefined);
    await Promise.all([first, second]);
    expect(events).toEqual([
      "first started",
      "first finished",
      "second started",
    ]);
  });

  test("does not block a different night", async () => {
    const runSerial = createKeyedSerialExecutor();
    const releaseFirst = Promise.withResolvers<undefined>();
    const first = runSerial("night-1", async () => {
      await releaseFirst.promise;
    });

    await expect(runSerial("night-2", async () => "ready")).resolves.toBe(
      "ready",
    );
    releaseFirst.resolve(undefined);
    await first;
  });

  test("continues after a failed operation", async () => {
    const runSerial = createKeyedSerialExecutor();
    await expect(
      runSerial("night-1", async () => {
        throw new Error("voice failed");
      }),
    ).rejects.toThrow("voice failed");
    await expect(runSerial("night-1", async () => "retried")).resolves.toBe(
      "retried",
    );
  });
});
