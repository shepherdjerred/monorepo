import { describe, expect, test } from "bun:test";
import { Emulator } from "./emulator.ts";

function createEmulator(): Emulator {
  return new Emulator({ wasmPath: "/unused/pokeemerald.wasm" });
}

describe("Emulator input lease", () => {
  test("rejects queued and new interactive input while a goal owns control", async () => {
    const emulator = createEmulator();
    const queued = emulator.queuePress(1, 2, 1);

    const release = emulator.acquireInputLease("goal");

    await expect(queued).rejects.toThrow("input lease acquired by goal");
    expect(() => emulator.queuePress(1, 1, 0)).toThrow(
      "input is exclusively leased by goal",
    );
    expect(() => {
      void emulator.queuePress(1, 1, 0, "goal");
    }).not.toThrow();

    release();
    expect(() => {
      void emulator.queuePress(1, 1, 0);
    }).not.toThrow();
  });

  test("an old release cannot unlock a newer lease", () => {
    const emulator = createEmulator();
    const releaseFirst = emulator.acquireInputLease("goal");
    releaseFirst();
    const releaseSecond = emulator.acquireInputLease("goal");

    releaseFirst();
    expect(() => emulator.queuePress(1, 1, 0)).toThrow(
      "input is exclusively leased by goal",
    );

    releaseSecond();
    expect(() => {
      void emulator.queuePress(1, 1, 0);
    }).not.toThrow();
  });
});
