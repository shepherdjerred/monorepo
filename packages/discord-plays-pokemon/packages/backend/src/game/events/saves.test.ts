import type { GameSymbols } from "#src/emulator/symbols.ts";
import { createMemoryReader } from "#src/emulator/memory.ts";
import { readGameSnapshot } from "./snapshot.ts";
import { speciesName } from "./generated/species.ts";
import type { GameSnapshot } from "./types.ts";

// Regression test over real Emerald saves (see testdata/README.md). We
// reassemble SaveBlock1/SaveBlock2 from the .sav's sectors, rebuild the in-RAM
// layout the emulator produces on load, and run the *production* readGameSnapshot
// over it — so this exercises the real parser against real encrypted data.

// ---- Gen-3 save format (battery file) ----
// 128 KiB = two 14-sector save slots (A: sectors 0-13, B: 14-27). Each sector is
// 0x1000 bytes: 0xF80 data + a footer (id u16 @0xFF4, checksum @0xFF6,
// signature u32 @0xFF8 = 0x08012025, counter u32 @0xFFC). The active slot is the
// valid one with the higher counter. SaveBlock2 = sector id 0; SaveBlock1 =
// sector ids 1..4 concatenated.
const SECTOR_SIZE = 0x10_00;
const SECTOR_DATA = 0xf_80;
const SECTOR_SIGNATURE = 0x08_01_20_25;

type SaveBlocks = { saveBlock1: Uint8Array; saveBlock2: Uint8Array };

function readSlot(
  bytes: Uint8Array,
  base: number,
): { sectors: Map<number, Uint8Array>; counter: number; valid: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectors = new Map<number, Uint8Array>();
  let counter = 0;
  let valid = false;
  for (let i = 0; i < 14; i++) {
    const off = base + i * SECTOR_SIZE;
    if (view.getUint32(off + 0xf_f8, true) !== SECTOR_SIGNATURE) continue;
    valid = true;
    sectors.set(
      view.getUint16(off + 0xf_f4, true),
      bytes.subarray(off, off + SECTOR_DATA),
    );
    counter = view.getUint32(off + 0xf_fc, true);
  }
  return { sectors, counter, valid };
}

function readGen3SaveBlocks(bytes: Uint8Array): SaveBlocks {
  const a = readSlot(bytes, 0);
  const b = readSlot(bytes, 0xe0_00);
  // Highest-counter valid slot wins (counters here are small — no wraparound).
  const active = !b.valid || (a.valid && a.counter >= b.counter) ? a : b;
  const saveBlock1 = new Uint8Array(SECTOR_DATA * 4);
  for (let id = 1; id <= 4; id++) {
    const data = active.sectors.get(id);
    if (data === undefined)
      throw new Error(`save missing SaveBlock1 sector ${String(id)}`);
    saveBlock1.set(data, (id - 1) * SECTOR_DATA);
  }
  const saveBlock2 = active.sectors.get(0);
  if (saveBlock2 === undefined)
    throw new Error("save missing SaveBlock2 sector");
  return { saveBlock1, saveBlock2 };
}

// SaveBlock1 field offsets (include/global.h).
const SB1_PARTY_COUNT = 0x2_34;
const SB1_PLAYER_PARTY = 0x2_38;

// Symbol addresses for the synthetic memory (arbitrary, non-overlapping).
const SYMBOLS: GameSymbols = {
  gSaveBlock1Ptr: 0x1_00,
  gSaveBlock2Ptr: 0x1_04,
  gPlayerPartyCount: 0x1_08,
  gPlayerParty: 0x2_00,
  gBattleResults: 0x1_80,
};
const SB1_ADDR = 0x1_00_00;
const SB2_ADDR = 0x2_00_00;

// Rebuild the in-RAM layout the emulator has after loading a save: the save
// blocks at their pointers, and gPlayerParty as a copy of SaveBlock1.playerParty
// (the load path copies it). Then read it with the production code.
function snapshotFromSave(bytes: Uint8Array): GameSnapshot | null {
  const { saveBlock1, saveBlock2 } = readGen3SaveBlocks(bytes);
  const memory = new WebAssembly.Memory({ initial: 0x40 }); // 4 MiB
  const view = new DataView(memory.buffer);
  const u8 = new Uint8Array(memory.buffer);

  view.setUint32(SYMBOLS.gSaveBlock1Ptr, SB1_ADDR, true);
  view.setUint32(SYMBOLS.gSaveBlock2Ptr, SB2_ADDR, true);
  u8.set(saveBlock1, SB1_ADDR);
  u8.set(saveBlock2, SB2_ADDR);
  view.setUint8(SYMBOLS.gPlayerPartyCount, saveBlock1[SB1_PARTY_COUNT] ?? 0);
  u8.set(
    saveBlock1.subarray(SB1_PLAYER_PARTY, SB1_PLAYER_PARTY + 6 * 100),
    SYMBOLS.gPlayerParty,
  );

  return readGameSnapshot(createMemoryReader(memory), SYMBOLS);
}

async function loadSnapshot(name: string): Promise<GameSnapshot> {
  const path = new URL(`testdata/${name}`, import.meta.url).pathname;
  const snap = snapshotFromSave(await Bun.file(path).bytes());
  if (snap === null) throw new Error(`snapshot was null for ${name}`);
  return snap;
}

function partyNames(snap: GameSnapshot): string[] {
  return snap.party.map((m) => speciesName(m.species));
}
function ownedCount(snap: GameSnapshot): number {
  let n = 0;
  for (const b of snap.dexOwned) for (let x = b; x > 0; x >>= 1) n += x & 1;
  return n;
}
function badgeNumbers(snap: GameSnapshot): number[] {
  return snap.badges.map((b, i) => (b ? i + 1 : 0)).filter((n) => n > 0);
}

describe("readGameSnapshot over real Emerald saves", () => {
  test("after_starter: early game, Torchic starter", async () => {
    const snap = await loadSnapshot("after_starter.sav");
    expect(snap.party).toHaveLength(2);
    expect(partyNames(snap)).toEqual(["TORCHIC", "FEEBAS"]);
    expect(snap.party[0]?.level).toBe(8);
    expect(snap.party[0]?.nickname).toBe("TORCHIC");
    expect(badgeNumbers(snap)).toEqual([]);
  });

  test("champion: full Lv60 team, 8 badges, complete Pokédex", async () => {
    const snap = await loadSnapshot("champion.sav");
    expect(snap.party).toHaveLength(6);
    expect(partyNames(snap)).toEqual([
      "MILOTIC",
      "BEAUTIFLY",
      "BLAZIKEN",
      "TROPIUS",
      "ABSOL",
      "MEW",
    ]);
    expect(snap.party.every((m) => m.level === 60)).toBe(true);
    expect(badgeNumbers(snap)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(ownedCount(snap)).toBe(386); // full national dex
  });

  test("midgame: 5-mon nicknamed party, 3 badges", async () => {
    const snap = await loadSnapshot("midgame.sav");
    expect(snap.party).toHaveLength(5);
    // Active (higher-counter) save slot.
    expect(partyNames(snap)).toEqual([
      "SHROOMISH",
      "COMBUSKEN",
      "VIGOROTH",
      "SWELLOW",
      "KADABRA",
    ]);
    expect(snap.party.map((m) => m.nickname)).toEqual([
      "1-UP",
      "KFC",
      "SID",
      "BIRB",
      "GURU",
    ]);
    expect(badgeNumbers(snap)).toEqual([1, 2, 3]);
    expect(ownedCount(snap)).toBe(11);
  });
});
