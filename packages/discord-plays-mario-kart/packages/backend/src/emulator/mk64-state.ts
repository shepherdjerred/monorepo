/**
 * Mario Kart 64 race state: the game's own globals (the bridge's STATE record,
 * spaghetti-src/patches/0002-host-bridge.patch) normalized into the snapshot
 * the leaderboard and overlays consume.
 */

export const PLAYER_FLAG_EXISTS = 0x80_00;
export const PLAYER_FLAG_HUMAN = 0x40_00;

const MAX_COURSE_ID = 0x14;
/** Award Ceremony — a cutscene "course", never a recordable race. */
export const COURSE_AWARD_CEREMONY = 0x14;

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
 * The raw MK64 globals a snapshot is decoded from, as the bridge's STATE
 * message carries them (engine/spaghetti/protocol.ts).
 */
export type Mk64RawState = {
  gamestate: number;
  racePhase: number;
  menuSelection: number;
  activeScreenMode: number;
  playerCountSelection: number;
  modeSelection: number;
  courseId: number;
  /** gPlayers[0..3]: type bitflags, 0-based rank, character id. */
  players: readonly Mk64RawPlayer[];
  /** playerHUD[0..3]: race clock in centiseconds, race-complete flag. */
  hud: readonly Mk64RawHud[];
};

export type Mk64RawPlayer = {
  type: number;
  currentRank: number;
  characterId: number;
};

export type Mk64RawHud = { timerCs: number; raceComplete: number };

/**
 * Normalize raw MK64 globals into one coherent view of the race. Values are
 * range-checked; if the globals look like garbage (mid-load), the snapshot
 * degrades to raceState "menu" so consumers simply see "not in a race".
 */
export function snapshotFromRawState(raw: Mk64RawState): Mk64Snapshot {
  const { courseId } = raw;
  const humanCountRaw = raw.playerCountSelection;

  // Range-check the raw enum indices numerically, then look them up. Both
  // lookups are provably defined once the range check passes (screenModeRaw and
  // modeRaw are within the table lengths), so the undefined branch is dead.
  const screenMode: ScreenMode | undefined = SCREEN_MODES[raw.activeScreenMode];
  const gameMode: GameMode | undefined = GAME_MODES[raw.modeSelection];
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
    const player = raw.players[slot];
    const hud = raw.hud[slot];
    if (player === undefined || hud === undefined) {
      throw new RangeError(`raw MK64 state is missing slot ${String(slot)}`);
    }
    const rank0 = player.currentRank;
    players.push({
      present: (player.type & PLAYER_FLAG_EXISTS) !== 0,
      human: (player.type & PLAYER_FLAG_HUMAN) !== 0,
      rank: rank0 >= 0 && rank0 <= 7 ? rank0 + 1 : 0,
      characterId: player.characterId,
      finished: hud.raceComplete === 1,
      // Cap at 24h: an unlatched/garbage timer must not overflow the DB column.
      raceTimeMs: Math.min(hud.timerCs * 10, 86_400_000),
    });
  }

  return {
    raceState: normalizeRaceState(
      raw.gamestate,
      raw.racePhase,
      raw.menuSelection,
    ),
    screenMode,
    gameMode,
    humanCount: humanCountRaw,
    courseId,
    players,
  };
}
