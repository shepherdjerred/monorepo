import type { MemoryReader } from "#src/emulator/memory.ts";
import type { GameSymbols } from "#src/emulator/symbols.ts";
import { snapshotInvalidTotal } from "#src/observability/metrics.ts";
import { parsePartyMon, PARTY_MAX, PARTY_MON_SIZE } from "./pokemon-struct.ts";
import type { GameSnapshot } from "./types.ts";

// Struct offsets verified against the pokeemerald-wasm source this build is
// compiled from (include/global.h, include/constants/flags.h,
// include/battle.h at tripplyons/pokeemerald-wasm).
const SAVE_BLOCK_1_FLAGS_OFFSET = 0x12_70;
const BADGE_FIRST_FLAG = 0x8_67; // FLAG_BADGE01_GET
const BADGE_COUNT = 8;
const SAVE_BLOCK_1_MIN_SIZE = 0x3d_88; // sizeof(struct SaveBlock1)

const SAVE_BLOCK_2_DEX_OWNED_OFFSET = 0x18 + 0x10; // pokedex @0x18, owned @+0x10
const DEX_FLAG_BYTES = 52;
const SAVE_BLOCK_2_MIN_SIZE = 0xf_2c; // sizeof(struct SaveBlock2)

const BATTLE_RESULTS_CAUGHT_SPECIES_OFFSET = 0x28;
const BATTLE_RESULTS_BITFIELD_OFFSET = 0x05;
// Byte 0x5 bitfield, LSB-first allocation (clang, little-endian):
// playerMonWasDamaged:1 usedMasterBall:1 caughtMonBall:4 shinyWildMon:1.
const SHINY_WILD_MON_BIT = 6;
// Farthest read: caughtMonSpecies u16 at 0x28 → need at least 0x2a bytes.
// (gBattleResults is a static, not a pointer, so no relocation concerns; we
// still range-check so an under-sized memory throws snapshotInvalidTotal, not
// a raw RangeError counted as frameHookErrorsTotal.)
const BATTLE_RESULTS_MIN_SIZE = 0x2a; // covers offsets 0x00–0x29

// Save block pointers are relocated periodically by the game (anti-cheat), so
// they must be dereferenced on every poll. Before a save is loaded (title
// screen, intro) they may be 0 or garbage; reject anything that could not be
// a valid heap location in the wasm's linear memory.
function validPointer(
  ptr: number,
  structSize: number,
  memorySize: number,
): boolean {
  return ptr >= 0x10_00 && ptr % 4 === 0 && ptr + structSize <= memorySize;
}

/**
 * Read one immutable snapshot of the game state, or null when the game is not
 * in a readable state (no save loaded yet, mid-relocation, etc.). Returning
 * null never produces events — the watcher just skips the poll.
 */
export function readGameSnapshot(
  reader: MemoryReader,
  symbols: GameSymbols,
): GameSnapshot | null {
  const sb1 = reader.u32(symbols.gSaveBlock1Ptr);
  const sb2 = reader.u32(symbols.gSaveBlock2Ptr);
  if (
    !validPointer(sb1, SAVE_BLOCK_1_MIN_SIZE, reader.byteLength) ||
    !validPointer(sb2, SAVE_BLOCK_2_MIN_SIZE, reader.byteLength)
  ) {
    snapshotInvalidTotal.inc();
    return null;
  }

  // gBattleResults is a static (not a pointer), but its address still must lie
  // within the wasm linear memory. Guard before reading so an out-of-bounds
  // access is counted as snapshotInvalidTotal rather than escaping as a
  // RangeError that would be attributed to frameHookErrorsTotal.
  if (symbols.gBattleResults + BATTLE_RESULTS_MIN_SIZE > reader.byteLength) {
    snapshotInvalidTotal.inc();
    return null;
  }

  const partyCount = reader.u8(symbols.gPlayerPartyCount);
  if (partyCount > PARTY_MAX) {
    snapshotInvalidTotal.inc();
    return null;
  }

  const party = [];
  for (let i = 0; i < partyCount; i++) {
    const mon = parsePartyMon(
      reader.bytes(symbols.gPlayerParty + i * PARTY_MON_SIZE, PARTY_MON_SIZE),
    );
    if (mon !== null) party.push(mon);
  }

  const badges = [];
  for (let i = 0; i < BADGE_COUNT; i++) {
    const flagId = BADGE_FIRST_FLAG + i;
    const byte = reader.u8(sb1 + SAVE_BLOCK_1_FLAGS_OFFSET + (flagId >> 3));
    badges.push(((byte >> (flagId & 7)) & 1) === 1);
  }

  return {
    party,
    badges,
    dexOwned: reader.bytes(sb2 + SAVE_BLOCK_2_DEX_OWNED_OFFSET, DEX_FLAG_BYTES),
    caughtMonSpecies: reader.u16(
      symbols.gBattleResults + BATTLE_RESULTS_CAUGHT_SPECIES_OFFSET,
    ),
    caughtMonShiny:
      ((reader.u8(symbols.gBattleResults + BATTLE_RESULTS_BITFIELD_OFFSET) >>
        SHINY_WILD_MON_BIT) &
        1) ===
      1,
  };
}
