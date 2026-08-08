import { describe, expect, it } from "bun:test";
import { serializedWorker } from "#server/serialized-worker";

describe("serializedWorker", () => {
  it("drops overlapping ticks and permits the next tick after completion", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = serializedWorker(async () => {
      calls += 1;
      await blocked;
    });

    const first = run();
    await run();
    expect(calls).toBe(1);
    if (release === undefined) throw new Error("worker release is unavailable");
    release();
    await first;

    await run();
    expect(calls).toBe(2);
  });
});
