import { describe, expect, test } from "bun:test";
import { createMemoryReader } from "#src/emulator/memory.ts";
import type { GameSymbols } from "#src/emulator/symbols.ts";
import { readMapObjects, readSpatialSnapshot } from "./spatial-snapshot.ts";

const SYMBOLS: GameSymbols = {
  gSaveBlock1Ptr: 0x10_00,
  gSaveBlock2Ptr: 0x10_04,
  gPlayerParty: 0x10_10,
  gPlayerPartyCount: 0x10_20,
  gBattleResults: 0x10_30,
  gPlayerAvatar: 0x11_00,
  gObjectEvents: 0x12_00,
};
const SAVE_BLOCK_1 = 0x20_00;

function setupMemory(): {
  memory: WebAssembly.Memory;
  view: DataView;
} {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const view = new DataView(memory.buffer);
  view.setUint32(SYMBOLS.gSaveBlock1Ptr, SAVE_BLOCK_1, true);
  view.setUint8(SYMBOLS.gPlayerAvatar + 5, 0);
  view.setUint8(SYMBOLS.gObjectEvents, 1);
  view.setUint8(SYMBOLS.gObjectEvents + 2, 1);
  view.setUint8(SYMBOLS.gObjectEvents + 9, 9);
  view.setUint8(SYMBOLS.gObjectEvents + 10, 0);
  view.setInt16(SYMBOLS.gObjectEvents + 0x10, 12, true);
  view.setInt16(SYMBOLS.gObjectEvents + 0x12, 7, true);
  view.setUint16(SYMBOLS.gObjectEvents + 0x18, 2, true);
  view.setUint8(SYMBOLS.gObjectEvents + 0x1e, 0);
  view.setUint8(SAVE_BLOCK_1 + 4, 0);
  view.setUint8(SAVE_BLOCK_1 + 5, 9);
  return { memory, view };
}

describe("readSpatialSnapshot", () => {
  test("uses SaveBlock1 location after a seamless map connection", () => {
    const { memory, view } = setupMemory();
    const reader = createMemoryReader(memory);
    expect(readSpatialSnapshot(reader, SYMBOLS)?.mapNum).toBe(9);

    // LoadMapFromCameraTransition updates SaveBlock1.location to Route 101
    // while the player ObjectEvent can still carry Littleroot's mapNum.
    view.setUint8(SAVE_BLOCK_1 + 5, 16);
    expect(readSpatialSnapshot(reader, SYMBOLS)?.mapNum).toBe(16);
  });

  test("decodes exact Emerald avatar movement flags", () => {
    const { memory, view } = setupMemory();
    const reader = createMemoryReader(memory);
    const cases: readonly [number, string][] = [
      [0x01, "on foot"],
      [0x02, "mach bike"],
      [0x04, "acro bike"],
      [0x08, "surfing"],
      [0x10, "diving"],
      [0x81, "running"],
    ];
    for (const [flags, expected] of cases) {
      view.setUint8(SYMBOLS.gPlayerAvatar, flags);
      expect(readSpatialSnapshot(reader, SYMBOLS)?.movementMode).toBe(expected);
    }
  });

  test("keeps observations compact while exposing every active map object", () => {
    const { memory, view } = setupMemory();
    const object = SYMBOLS.gObjectEvents + 0x24;
    view.setUint8(object, 1);
    view.setUint8(object + 5, 59);
    view.setUint8(object + 9, 9);
    view.setUint8(object + 10, 0);
    view.setInt16(object + 0x10, 25, true);
    view.setInt16(object + 0x12, 7, true);
    view.setUint16(object + 0x18, 3, true);

    const reader = createMemoryReader(memory);
    expect(readSpatialSnapshot(reader, SYMBOLS)?.nearby).toEqual([]);
    expect(readMapObjects(reader, SYMBOLS)).toEqual([
      {
        x: 25,
        y: 7,
        distance: 13,
        facing: "west",
        kind: "item",
        graphicsId: 59,
      },
    ]);
  });
});
