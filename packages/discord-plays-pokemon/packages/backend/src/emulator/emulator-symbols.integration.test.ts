import { Emulator } from "./emulator.ts";
import { readGameSnapshot } from "#src/game/events/snapshot.ts";

// Boots the real checked-in pokeemerald.wasm and asserts the game-state symbols
// still resolve and a snapshot read doesn't throw. The wasm is sha-pinned, so
// this only breaks when the binary is intentionally refreshed — at which point
// it's the canary for renamed/moved symbols before they reach production.

const WASM_PATH = new URL("../../assets/pokeemerald.wasm", import.meta.url)
  .pathname;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("emulator game symbols (real wasm)", () => {
  test("resolves all symbols and reads snapshots without throwing", async () => {
    const emulator = new Emulator({ wasmPath: WASM_PATH });
    await emulator.init();

    const symbols = emulator.gameSymbols();
    // Every symbol must resolve to a plausible linear-memory address.
    for (const [name, address] of Object.entries(symbols)) {
      expect(address, name).toBeGreaterThan(0x10_00);
      expect(address, name).toBeLessThan(0x10_00_00_00);
    }

    const reader = emulator.memoryReader();
    // Fresh boot: no save loaded yet, so this is expected to be null — the
    // contract is "doesn't throw", which is what the watcher relies on.
    expect(() => readGameSnapshot(reader, symbols)).not.toThrow();

    // Run a few hundred frames and confirm reads stay safe as the game runs.
    emulator.start();
    const target = emulator.frame + 200;
    const deadline = Date.now() + 15_000;
    while (emulator.frame < target && Date.now() < deadline) {
      await sleep(50);
    }
    emulator.stop();

    expect(emulator.frame).toBeGreaterThan(target - 1);
    expect(() => readGameSnapshot(reader, symbols)).not.toThrow();
  }, 30_000);
});
