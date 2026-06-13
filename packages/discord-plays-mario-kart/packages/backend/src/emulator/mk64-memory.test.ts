import { describe, expect, test } from "bun:test";
import {
  MK64_ADDR,
  PLAYER_FLAG_EXISTS,
  PLAYER_FLAG_HUMAN,
  physical,
  readS8,
  readS16,
  readS32,
  readSnapshot,
  readU8,
  readU16,
  readU32,
} from "./mk64-memory.ts";
import type { RdramView } from "./mk64-memory.ts";

const BASE = 64; // arbitrary RDRAM offset within the fake wasm heap

function makeHeap(): RdramView {
  // Enough to cover the highest address we touch (hud array ~0x18CCxx).
  return { base: BASE, heap: new Uint8Array(BASE + 0x19_00_00) };
}

/**
 * Store one aligned N64 word exactly the way mupen64plus-core does on a
 * little-endian host: the big-endian word VALUE is kept numerically, so its
 * bytes land swapped in memory. Independent of the reader's ^3 trick.
 */
function storeWord(mem: RdramView, vaddr: number, value: number): void {
  const phys = physical(vaddr) & ~3;
  new DataView(mem.heap.buffer).setUint32(mem.base + phys, value >>> 0, true);
}

/** Write an N64 byte at an arbitrary (possibly unaligned) virtual address. */
function storeByte(mem: RdramView, vaddr: number, value: number): void {
  const phys = physical(vaddr);
  const word = phys & ~3;
  const view = new DataView(mem.heap.buffer);
  const existing = view.getUint32(mem.base + word, true);
  const shift = (3 - (phys & 3)) * 8; // big-endian byte position within the word
  const cleared = existing & ~(0xff << shift);
  view.setUint32(
    mem.base + word,
    (cleared | ((value & 0xff) << shift)) >>> 0,
    true,
  );
}

function storeHalf(mem: RdramView, vaddr: number, value: number): void {
  storeByte(mem, vaddr, (value >> 8) & 0xff);
  storeByte(mem, vaddr + 1, value & 0xff);
}

describe("RDRAM byte-order contract", () => {
  test("u8/u16/u32 reads decode a big-endian N64 word stored host-endian", () => {
    const mem = makeHeap();
    storeWord(mem, 0x80_00_01_00, 0xaa_bb_cc_dd);

    expect(readU8(mem, 0x80_00_01_00)).toBe(0xaa);
    expect(readU8(mem, 0x80_00_01_01)).toBe(0xbb);
    expect(readU8(mem, 0x80_00_01_02)).toBe(0xcc);
    expect(readU8(mem, 0x80_00_01_03)).toBe(0xdd);
    expect(readU16(mem, 0x80_00_01_00)).toBe(0xaa_bb);
    expect(readU16(mem, 0x80_00_01_02)).toBe(0xcc_dd);
    expect(readU32(mem, 0x80_00_01_00)).toBe(0xaa_bb_cc_dd);
  });

  test("signed variants sign-extend", () => {
    const mem = makeHeap();
    storeWord(mem, 0x80_00_02_00, 0xff_fe_ff_80);
    expect(readS16(mem, 0x80_00_02_00)).toBe(-2);
    expect(readS8(mem, 0x80_00_02_03)).toBe(-128);
    storeWord(mem, 0x80_00_02_04, 0xff_ff_ff_ff);
    expect(readS32(mem, 0x80_00_02_04)).toBe(-1);
  });

  test("byte writes round-trip through unaligned addresses", () => {
    const mem = makeHeap();
    storeByte(mem, 0x80_00_03_01, 0x5a);
    expect(readU8(mem, 0x80_00_03_01)).toBe(0x5a);
    expect(readU8(mem, 0x80_00_03_00)).toBe(0);
  });
});

function storeRaceScene(mem: RdramView): void {
  storeWord(mem, MK64_ADDR.gGamestate, 4); // RACING
  storeWord(mem, MK64_ADDR.racePhase, 3); // racing ("GO")
  storeWord(mem, MK64_ADDR.gMenuSelection, 14); // player-initiated race
  storeWord(mem, MK64_ADDR.gActiveScreenMode, 3); // quad
  storeWord(mem, MK64_ADDR.gPlayerCountSelection1, 2);
  storeWord(mem, MK64_ADDR.gModeSelection, 2); // versus
  storeHalf(mem, MK64_ADDR.gCurrentCourseId, 8); // Luigi Raceway

  // Slot 0: human, 1st place (0-based rank 0), Yoshi, finished at 92.34s.
  const p0 = MK64_ADDR.playerBase;
  storeHalf(
    mem,
    p0 + MK64_ADDR.playerOffsets.type,
    PLAYER_FLAG_EXISTS | PLAYER_FLAG_HUMAN,
  );
  storeHalf(mem, p0 + MK64_ADDR.playerOffsets.currentRank, 0);
  storeHalf(mem, p0 + MK64_ADDR.playerOffsets.characterId, 2);
  const h0 = MK64_ADDR.hudBase;
  storeWord(mem, h0 + MK64_ADDR.hudOffsets.someTimer, 9234);
  storeByte(mem, h0 + MK64_ADDR.hudOffsets.raceCompleteBool, 1);

  // Slot 1: human, 6th place, Bowser, still racing.
  const p1 = MK64_ADDR.playerBase + MK64_ADDR.playerStride;
  storeHalf(
    mem,
    p1 + MK64_ADDR.playerOffsets.type,
    PLAYER_FLAG_EXISTS | PLAYER_FLAG_HUMAN,
  );
  storeHalf(mem, p1 + MK64_ADDR.playerOffsets.currentRank, 5);
  storeHalf(mem, p1 + MK64_ADDR.playerOffsets.characterId, 7);
  const h1 = MK64_ADDR.hudBase + MK64_ADDR.hudStride;
  storeWord(mem, h1 + MK64_ADDR.hudOffsets.someTimer, 9300);

  // Slot 2: CPU kart.
  const p2 = MK64_ADDR.playerBase + 2 * MK64_ADDR.playerStride;
  storeHalf(mem, p2 + MK64_ADDR.playerOffsets.type, PLAYER_FLAG_EXISTS);
  storeHalf(mem, p2 + MK64_ADDR.playerOffsets.currentRank, 1);
}

describe("readSnapshot", () => {
  test("parses a coherent racing scene", () => {
    const mem = makeHeap();
    storeRaceScene(mem);
    const snap = readSnapshot(mem);
    expect(snap).toMatchObject({
      raceState: "racing",
      screenMode: "quad",
      gameMode: "versus",
      humanCount: 2,
      courseId: 8,
    });
    expect(snap.players[0]).toEqual({
      present: true,
      human: true,
      rank: 1,
      characterId: 2,
      finished: true,
      raceTimeMs: 92_340,
    });
    expect(snap.players[1]).toMatchObject({
      human: true,
      rank: 6,
      characterId: 7,
      finished: false,
      raceTimeMs: 93_000,
    });
    expect(snap.players[2]).toMatchObject({ present: true, human: false });
    expect(snap.players[3]).toMatchObject({ present: false });
  });

  test("phase transitions map to normalized race states", () => {
    const mem = makeHeap();
    storeRaceScene(mem);
    for (const [phase, expected] of [
      [0, "staging"],
      [2, "staging"],
      [3, "racing"],
      [4, "finished"],
      [5, "finished"],
      [6, "menu"],
    ] as const) {
      storeWord(mem, MK64_ADDR.racePhase, phase);
      expect(readSnapshot(mem).raceState).toBe(expected);
    }
    // Out of the racing gamestate entirely (e.g. main menu).
    storeWord(mem, MK64_ADDR.racePhase, 3);
    storeWord(mem, MK64_ADDR.gGamestate, 0);
    expect(readSnapshot(mem).raceState).toBe("menu");
    // The attract demo: gamestate races, but the menu stays on the logo.
    storeWord(mem, MK64_ADDR.gGamestate, 4);
    storeWord(mem, MK64_ADDR.gMenuSelection, 8);
    expect(readSnapshot(mem).raceState).toBe("menu");
  });

  test("garbage globals degrade to a menu snapshot", () => {
    const mem = makeHeap();
    storeRaceScene(mem);
    storeHalf(mem, MK64_ADDR.gCurrentCourseId, 999);
    const snap = readSnapshot(mem);
    expect(snap.raceState).toBe("menu");
    expect(snap.courseId).toBe(-1);
    expect(snap.players).toEqual([]);
  });

  test("out-of-range timer is capped, out-of-range rank reads as 0", () => {
    const mem = makeHeap();
    storeRaceScene(mem);
    storeWord(
      mem,
      MK64_ADDR.hudBase + MK64_ADDR.hudOffsets.someTimer,
      0xff_ff_ff_ff,
    );
    storeHalf(
      mem,
      MK64_ADDR.playerBase + MK64_ADDR.playerOffsets.currentRank,
      0x7f_ff,
    );
    const snap = readSnapshot(mem);
    expect(snap.players[0]?.raceTimeMs).toBe(86_400_000);
    expect(snap.players[0]?.rank).toBe(0);
  });
});
