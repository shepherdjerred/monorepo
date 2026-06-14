import type { GameSymbols } from "#src/emulator/symbols.ts";
import { createMemoryReader } from "#src/emulator/memory.ts";
import { createGameEventWatcher } from "./watcher.ts";
import { buildMon } from "./pokemon-struct.test.ts";

const SYMBOLS: GameSymbols = {
  gSaveBlock1Ptr: 0x1_00,
  gSaveBlock2Ptr: 0x1_04,
  gPlayerPartyCount: 0x1_08,
  gPlayerParty: 0x2_00,
  gBattleResults: 0x1_80,
};
const SB1 = 0x1_00_00;
const SB2 = 0x4_00_00;

// A mutable synthetic world; the reader sees writes because typed-array views
// over a WebAssembly.Memory buffer are live.
function makeWorld() {
  const memory = new WebAssembly.Memory({ initial: 16 });
  const view = new DataView(memory.buffer);
  const u8 = new Uint8Array(memory.buffer);

  function setSavePointer(valid: boolean): void {
    view.setUint32(SYMBOLS.gSaveBlock1Ptr, valid ? SB1 : 0, true);
    view.setUint32(SYMBOLS.gSaveBlock2Ptr, valid ? SB2 : 0, true);
  }
  function setPartyHp(hp: number): void {
    view.setUint8(SYMBOLS.gPlayerPartyCount, 2);
    u8.set(
      buildMon({
        personality: 1,
        otId: 1,
        species: 277,
        level: 5,
        hp,
        maxHp: 20,
      }),
      SYMBOLS.gPlayerParty,
    );
    // A second, always-healthy mon so fainting the first is a faint (not a
    // whole-party whiteout).
    u8.set(
      buildMon({
        personality: 2,
        otId: 2,
        species: 280,
        level: 5,
        hp: 20,
        maxHp: 20,
      }),
      SYMBOLS.gPlayerParty + 100,
    );
  }

  setSavePointer(true);
  setPartyHp(20);
  return { reader: createMemoryReader(memory), setSavePointer, setPartyHp };
}

describe("createGameEventWatcher", () => {
  test("first valid poll is baseline only", () => {
    const world = makeWorld();
    const watcher = createGameEventWatcher({
      reader: world.reader,
      symbols: SYMBOLS,
    });
    expect(watcher.poll()).toHaveLength(0);
  });

  test("detects a faint across polls", () => {
    const world = makeWorld();
    const watcher = createGameEventWatcher({
      reader: world.reader,
      symbols: SYMBOLS,
    });
    watcher.poll();
    world.setPartyHp(0);
    expect(watcher.poll().map((e) => e.kind)).toEqual(["faint"]);
  });

  test("an invalid poll preserves the baseline; event still fires across the gap", () => {
    const world = makeWorld();
    const watcher = createGameEventWatcher({
      reader: world.reader,
      symbols: SYMBOLS,
    });
    watcher.poll();
    world.setSavePointer(false);
    expect(watcher.poll()).toHaveLength(0); // null snapshot, baseline kept
    world.setSavePointer(true);
    world.setPartyHp(0);
    expect(watcher.poll().map((e) => e.kind)).toEqual(["faint"]);
  });
});
