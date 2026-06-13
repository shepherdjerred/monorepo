import type { ParsedPartyMon } from "./pokemon-struct.ts";

// An immutable poll of the game state we diff to detect events. Contains no
// live memory views — everything is copied out at read time.
export type GameSnapshot = {
  party: readonly ParsedPartyMon[];
  /** Badge flags FLAG_BADGE01_GET..FLAG_BADGE08_GET, index 0-7. */
  badges: readonly boolean[];
  /** Pokédex owned bitfield (NUM_DEX_FLAG_BYTES = 52 bytes). */
  dexOwned: Uint8Array;
  /** gBattleResults.caughtMonSpecies — nonzero after a successful catch. */
  caughtMonSpecies: number;
  /** gBattleResults.shinyWildMon. */
  caughtMonShiny: boolean;
};

export type GameEvent =
  | { kind: "faint"; species: number; nickname: string; level: number }
  | { kind: "whiteout" }
  | { kind: "badge"; badgeIndex: number }
  | {
      kind: "evolution";
      fromSpecies: number;
      toSpecies: number;
      nickname: string;
      level: number;
    }
  | { kind: "catch"; species: number; shiny: boolean }
  | {
      kind: "levelUp";
      species: number;
      nickname: string;
      fromLevel: number;
      toLevel: number;
    }
  | { kind: "dexEntry"; nationalDexNumber: number };

export type GameEventKind = GameEvent["kind"];
