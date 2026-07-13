/**
 * Mario Kart 64 (US ROM) RDRAM reader.
 *
 * Addresses come from the n64decomp/mk64 symbol map (the decomp matches the
 * US cart byte-for-byte; `D_<addr>` names encode exact RAM addresses) and are
 * cross-validated against published GameShark codes. They are US-ROM-only.
 *
 * Byte-order contract (see wasm-src/PATCHES.md, patch 0003): mupen64plus-core
 * stores RDRAM as host-endian (little-endian under wasm) 32-bit words, so for
 * an N64 virtual address A (KSEG0 0x80xxxxxx, physical = A & 0x7FFFFF):
 *   u8  -> heap[base + (phys ^ 3)]
 *   u16 -> little-endian read at base + (phys ^ 2)   (2-aligned)
 *   u32 -> little-endian read at base + phys          (4-aligned)
 * This module is the only place that contract is allowed to live.
 */

/** RDRAM window into wasm linear memory, from N64Emulator.rdram(). */
export type RdramView = { base: number; heap: Uint8Array };

export const MK64_ADDR = {
  /** s32: 4 = racing, 5 = ending/podium (include/defines.h gGamestate). */
  gGamestate: 0x80_0d_c5_0c,
  /**
   * s32 race phase (verified in-emulator 2026-06-12): 0 course load,
   * 1 intro pan, 2 countdown, 3 racing ("GO"), 4/5 outcome decided,
   * 6 quitting. Note: a full 32-bit word, NOT the u16 the decomp notes imply.
   */
  racePhase: 0x80_0d_c5_10,
  /**
   * s32 menu/screen selection: 8 logo/attract, 10 start menu, 11 main menu,
   * 12 character select, 13 course select, 14 racing. Gates race detection:
   * the attract demo races with gGamestate=4 but keeps this at 8.
   */
  gMenuSelection: 0x80_0e_86_a0,
  /** s32: 0 = 1P full, 1 = 2P horizontal split, 2 = 2P vertical split, 3 = 3/4P quad. */
  gActiveScreenMode: 0x80_0d_c5_2c,
  /** s32: number of human players selected, 1..4. */
  gPlayerCountSelection1: 0x80_0d_c5_38,
  /** s32: 0 = GP, 1 = Time Trials, 2 = Versus, 3 = Battle. */
  gModeSelection: 0x80_0d_c5_3c,
  /** s16: current course id, 0x00..0x14 (internal order, not menu order). */
  gCurrentCourseId: 0x80_0d_c5_a0,
  /** Player gPlayers[8]; humans occupy slots 0..3 (= seats). */
  playerBase: 0x80_0f_69_90,
  playerStride: 0xd_d8,
  playerOffsets: {
    /** u16 bitflags. */
    type: 0x00,
    /** s16, 0-based (0 = 1st place). */
    currentRank: 0x04,
    /** u16, see CHARACTER_NAMES. */
    characterId: 0x2_54,
  },
  /** hud_player playerHUD[4], indexed by human player id. */
  hudBase: 0x80_18_ca_70,
  hudStride: 0x84,
  hudOffsets: {
    /** u32 centiseconds; latched to the final 3-lap total at finish. */
    someTimer: 0x08,
    /** s8: set to 1 exactly when this player's race completes. */
    raceCompleteBool: 0x70,
  },
} as const;

export const PLAYER_FLAG_EXISTS = 0x80_00;
export const PLAYER_FLAG_HUMAN = 0x40_00;

const RDRAM_MASK = 0x7f_ff_ff;
const MAX_COURSE_ID = 0x14;
/** Award Ceremony — a cutscene "course", never a recordable race. */
export const COURSE_AWARD_CEREMONY = 0x14;

export const COURSE_NAMES: readonly string[] = [
  "Mario Raceway",
  "Choco Mountain",
  "Bowser's Castle",
  "Banshee Boardwalk",
  "Yoshi Valley",
  "Frappe Snowland",
  "Koopa Troopa Beach",
  "Royal Raceway",
  "Luigi Raceway",
  "Moo Moo Farm",
  "Toad's Turnpike",
  "Kalimari Desert",
  "Sherbet Land",
  "Rainbow Road",
  "Wario Stadium",
  "Block Fort",
  "Skyscraper",
  "Double Deck",
  "D.K.'s Jungle Parkway",
  "Big Donut",
  "Award Ceremony",
];

export const CHARACTER_NAMES: readonly string[] = [
  "Mario",
  "Luigi",
  "Yoshi",
  "Toad",
  "Donkey Kong",
  "Wario",
  "Peach",
  "Bowser",
];

export function physical(vaddr: number): number {
  return vaddr & RDRAM_MASK;
}

// Bounds are checked numerically up front via requireInBounds. The reads below
// then use `?? 0` only to satisfy noUncheckedIndexedAccess: once requireInBounds
// has passed, every indexed access is provably in range, so the fallback is
// never taken.
function requireInBounds(mem: RdramView, offset: number, span: number): void {
  if (offset < 0 || offset + span > mem.heap.length) {
    throw new RangeError(
      `RDRAM read out of bounds at heap offset ${String(offset)}`,
    );
  }
}

export function readU8(mem: RdramView, vaddr: number): number {
  const off = mem.base + (physical(vaddr) ^ 3);
  requireInBounds(mem, off, 1);
  return mem.heap[off] ?? 0;
}

export function readS8(mem: RdramView, vaddr: number): number {
  const u = readU8(mem, vaddr);
  return u >= 0x80 ? u - 0x1_00 : u;
}

export function readU16(mem: RdramView, vaddr: number): number {
  const off = mem.base + (physical(vaddr) ^ 2);
  requireInBounds(mem, off, 2);
  return (mem.heap[off] ?? 0) | ((mem.heap[off + 1] ?? 0) << 8);
}

export function readS16(mem: RdramView, vaddr: number): number {
  const u = readU16(mem, vaddr);
  return u >= 0x80_00 ? u - 0x1_00_00 : u;
}

export function readU32(mem: RdramView, vaddr: number): number {
  const off = mem.base + (physical(vaddr) & ~3);
  requireInBounds(mem, off, 4);
  return (
    ((mem.heap[off] ?? 0) |
      ((mem.heap[off + 1] ?? 0) << 8) |
      ((mem.heap[off + 2] ?? 0) << 16) |
      ((mem.heap[off + 3] ?? 0) << 24)) >>>
    0
  );
}

export function readS32(mem: RdramView, vaddr: number): number {
  const u = readU32(mem, vaddr);
  return u >= 0x80_00_00_00 ? u - 0x1_00_00_00_00 : u;
}

/** Matches gActiveScreenMode's 0..3 encoding. */
export type ScreenMode = "1p" | "2p-horizontal" | "2p-vertical" | "quad";

/**
 * Normalized race state. "staging" covers the pre-race pipeline (course load,
 * intro pan, countdown) so a race restart is distinguishable from the menu.
 */
export type RaceState = "menu" | "staging" | "racing" | "finished";

export type GameMode = "gp" | "time-trials" | "versus" | "battle";

export type Mk64PlayerSnapshot = {
  /** Player slot has a kart (type & EXISTS). */
  present: boolean;
  /** Human-controlled (type & HUMAN). False for CPUs and TT ghosts. */
  human: boolean;
  /** Race placement, 1-based (1 = 1st .. 8 = 8th). */
  rank: number;
  characterId: number;
  /** This player's race is complete (hud raceCompleteBool). */
  finished: boolean;
  /** Race clock in ms; latched to the final 3-lap total once finished. */
  raceTimeMs: number;
};

export type Mk64Snapshot = {
  raceState: RaceState;
  screenMode: ScreenMode;
  gameMode: GameMode;
  /** Humans selected (1..4); also the number of meaningful entries in players. */
  humanCount: number;
  courseId: number;
  /** Seats 0..3 (player slots; humans always occupy the low slots). */
  players: Mk64PlayerSnapshot[];
};

const SCREEN_MODES: readonly ScreenMode[] = [
  "1p",
  "2p-horizontal",
  "2p-vertical",
  "quad",
];
const GAME_MODES: readonly GameMode[] = [
  "gp",
  "time-trials",
  "versus",
  "battle",
];

const GAMESTATE_RACING = 4;
const MENU_RACING = 14;
const PHASE_STAGING_MIN = 0;
const PHASE_RACING = 3;
const PHASE_DECIDED_GP = 4;
const PHASE_DECIDED_VS = 5;
const PHASE_QUITTING = 6;
const PHASE_BATTLE_DECIDED = 7;

function normalizeRaceState(
  gamestate: number,
  phase: number,
  menuSelection: number,
): RaceState {
  // The attract demo runs real races with gGamestate=4, but gMenuSelection
  // stays on the logo screen (8) — only player-initiated races reach 14.
  if (gamestate !== GAMESTATE_RACING || menuSelection !== MENU_RACING) {
    return "menu";
  }
  if (phase === PHASE_RACING) return "racing";
  if (
    phase === PHASE_DECIDED_GP ||
    phase === PHASE_DECIDED_VS ||
    phase === PHASE_BATTLE_DECIDED
  ) {
    return "finished";
  }
  if (phase >= PHASE_STAGING_MIN && phase < PHASE_RACING) return "staging";
  if (phase === PHASE_QUITTING) return "menu";
  // Anything unrecognized: treat as out-of-race.
  return "menu";
}

/**
 * Read one coherent view of the race state. Values are range-checked; if the
 * core globals look like garbage (mid-load), the snapshot degrades to
 * raceState "menu" so consumers simply see "not in a race".
 */
export function readSnapshot(mem: RdramView): Mk64Snapshot {
  const gamestate = readS32(mem, MK64_ADDR.gGamestate);
  const phase = readS32(mem, MK64_ADDR.racePhase);
  const menuSelection = readS32(mem, MK64_ADDR.gMenuSelection);
  const screenModeRaw = readS32(mem, MK64_ADDR.gActiveScreenMode);
  const humanCountRaw = readS32(mem, MK64_ADDR.gPlayerCountSelection1);
  const modeRaw = readS32(mem, MK64_ADDR.gModeSelection);
  const courseId = readS16(mem, MK64_ADDR.gCurrentCourseId);

  // Range-check the raw enum indices numerically, then look them up. Both
  // lookups are provably defined once the range check passes (screenModeRaw and
  // modeRaw are within the table lengths), so the undefined branch is dead.
  const screenMode: ScreenMode | undefined = SCREEN_MODES[screenModeRaw];
  const gameMode: GameMode | undefined = GAME_MODES[modeRaw];
  const valid =
    screenMode !== undefined &&
    gameMode !== undefined &&
    humanCountRaw >= 1 &&
    humanCountRaw <= 4 &&
    courseId >= 0 &&
    courseId <= MAX_COURSE_ID;

  if (!valid) {
    return {
      raceState: "menu",
      screenMode: "1p",
      gameMode: "gp",
      humanCount: 1,
      courseId: -1,
      players: [],
    };
  }

  const players: Mk64PlayerSnapshot[] = [];
  for (let slot = 0; slot < 4; slot++) {
    const playerAddr = MK64_ADDR.playerBase + slot * MK64_ADDR.playerStride;
    const hudAddr = MK64_ADDR.hudBase + slot * MK64_ADDR.hudStride;
    const type = readU16(mem, playerAddr + MK64_ADDR.playerOffsets.type);
    const rank0 = readS16(
      mem,
      playerAddr + MK64_ADDR.playerOffsets.currentRank,
    );
    const timerCs = readU32(mem, hudAddr + MK64_ADDR.hudOffsets.someTimer);
    players.push({
      present: (type & PLAYER_FLAG_EXISTS) !== 0,
      human: (type & PLAYER_FLAG_HUMAN) !== 0,
      rank: rank0 >= 0 && rank0 <= 7 ? rank0 + 1 : 0,
      characterId: readU16(
        mem,
        playerAddr + MK64_ADDR.playerOffsets.characterId,
      ),
      finished:
        readS8(mem, hudAddr + MK64_ADDR.hudOffsets.raceCompleteBool) === 1,
      // Cap at 24h: an unlatched/garbage timer must not overflow the DB column.
      raceTimeMs: Math.min(timerCs * 10, 86_400_000),
    });
  }

  return {
    raceState: normalizeRaceState(gamestate, phase, menuSelection),
    screenMode,
    gameMode,
    humanCount: humanCountRaw,
    courseId,
    players,
  };
}
