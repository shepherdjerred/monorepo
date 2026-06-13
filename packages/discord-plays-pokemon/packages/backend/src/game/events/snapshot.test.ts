import type { MemoryReader } from "#src/emulator/memory.ts";
import type { GameSymbols } from "#src/emulator/symbols.ts";
import { createMemoryReader } from "#src/emulator/memory.ts";
import { readGameSnapshot } from "./snapshot.ts";
import { buildMon } from "./pokemon-struct.test.ts";
import { PARTY_MON_SIZE } from "./pokemon-struct.ts";

// Lay out a tiny synthetic "linear memory" with the globals and save blocks at
// chosen addresses, then read it through the real createMemoryReader.
const MEM_SIZE = 0x10_00_00;
const SYMBOLS: GameSymbols = {
  gSaveBlock1Ptr: 0x1_00,
  gSaveBlock2Ptr: 0x1_04,
  gPlayerPartyCount: 0x1_08,
  gPlayerParty: 0x2_00,
  gBattleResults: 0x1_80,
};
const SB1 = 0x1_00_00;
const SB2 = 0x4_00_00;
const FLAGS_OFFSET = 0x12_70;
const DEX_OWNED_OFFSET = 0x28;

function buildMemory(opts: {
  sb1?: number;
  sb2?: number;
  partyCount?: number;
  party?: Uint8Array[];
  badgeByte?: number;
  dexByte?: number;
  caughtSpecies?: number;
  caughtBitfield?: number;
}): MemoryReader {
  const memory = new WebAssembly.Memory({ initial: MEM_SIZE / 0x1_00_00 });
  const buffer = memory.buffer;
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  view.setUint32(SYMBOLS.gSaveBlock1Ptr, opts.sb1 ?? SB1, true);
  view.setUint32(SYMBOLS.gSaveBlock2Ptr, opts.sb2 ?? SB2, true);
  view.setUint8(SYMBOLS.gPlayerPartyCount, opts.partyCount ?? 0);
  (opts.party ?? []).forEach((mon, i) => {
    u8.set(mon, SYMBOLS.gPlayerParty + i * PARTY_MON_SIZE);
  });
  const sb1 = opts.sb1 ?? SB1;
  const sb2 = opts.sb2 ?? SB2;
  // Skip save-block writes when the pointer is deliberately out of bounds
  // (those tests only care that the read returns null).
  if (sb1 + FLAGS_OFFSET + 0x20 < MEM_SIZE) {
    // Badge flags live at sb1 + 0x1270; FLAG_BADGE01_GET is bit 0x867, i.e.
    // byte (0x867 >> 3) bit (0x867 & 7) = bit 7.
    view.setUint8(sb1 + FLAGS_OFFSET + (0x8_67 >> 3), opts.badgeByte ?? 0);
  }
  if (sb2 + DEX_OWNED_OFFSET < MEM_SIZE) {
    view.setUint8(sb2 + DEX_OWNED_OFFSET, opts.dexByte ?? 0);
  }
  view.setUint16(SYMBOLS.gBattleResults + 0x28, opts.caughtSpecies ?? 0, true);
  view.setUint8(SYMBOLS.gBattleResults + 0x05, opts.caughtBitfield ?? 0);
  return createMemoryReader(memory);
}

describe("readGameSnapshot", () => {
  test("returns null when save block pointer is zero", () => {
    expect(readGameSnapshot(buildMemory({ sb1: 0 }), SYMBOLS)).toBeNull();
  });

  test("returns null when save block pointer is unaligned", () => {
    expect(
      readGameSnapshot(buildMemory({ sb1: 0x1_00_01 }), SYMBOLS),
    ).toBeNull();
  });

  test("returns null when save block pointer is out of bounds", () => {
    expect(
      readGameSnapshot(buildMemory({ sb1: MEM_SIZE }), SYMBOLS),
    ).toBeNull();
  });

  test("returns null when party count exceeds 6", () => {
    expect(
      readGameSnapshot(buildMemory({ partyCount: 7 }), SYMBOLS),
    ).toBeNull();
  });

  test("reads party, badges, dex and catch from the correct offsets", () => {
    const reader = buildMemory({
      partyCount: 1,
      party: [
        buildMon({
          personality: 11,
          otId: 22,
          species: 277,
          level: 7,
          hp: 5,
          maxHp: 22,
        }),
      ],
      badgeByte: 0b1000_0000, // bit 7 (flag 0x867) => badge index 0
      dexByte: 0b1, // national #1
      caughtSpecies: 263,
      caughtBitfield: 0b0100_0000, // shinyWildMon bit 6
    });
    const snap = readGameSnapshot(reader, SYMBOLS);
    expect(snap).not.toBeNull();
    expect(snap?.party).toHaveLength(1);
    expect(snap?.party[0]?.species).toBe(277);
    expect(snap?.party[0]?.level).toBe(7);
    expect(snap?.badges[0]).toBe(true);
    expect(snap?.badges[1]).toBe(false);
    expect(snap?.caughtMonSpecies).toBe(263);
    expect(snap?.caughtMonShiny).toBe(true);
    expect(snap?.dexOwned[0]).toBe(0b1);
  });

  test("skips empty/torn party slots without throwing", () => {
    const reader = buildMemory({
      partyCount: 2,
      party: [new Uint8Array(PARTY_MON_SIZE)],
    });
    const snap = readGameSnapshot(reader, SYMBOLS);
    expect(snap?.party).toHaveLength(0);
  });
});
