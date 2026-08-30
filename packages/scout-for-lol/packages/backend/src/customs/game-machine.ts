import {
  CustomGameStateSchema,
  type CustomGameState,
} from "@scout-for-lol/data";

export type CustomGameEvent =
  | "CAPTAINS_SELECTED"
  | "START_DRAFT"
  | "TEAMS_LOCKED"
  | "CODE_CREATED"
  | "GAME_STARTED"
  | "AWAIT_RIOT"
  | "RIOT_RESULT"
  | "VOID_GAME";

const TRANSITIONS: Readonly<
  Partial<Record<CustomGameState, Partial<Record<CustomGameEvent, string>>>>
> = {
  ROSTER_OPEN: { CAPTAINS_SELECTED: "CAPTAINS_SET", VOID_GAME: "VOID" },
  CAPTAINS_SET: {
    START_DRAFT: "DRAFTING",
    TEAMS_LOCKED: "CODE_PENDING",
    VOID_GAME: "VOID",
  },
  DRAFTING: { TEAMS_LOCKED: "CODE_PENDING", VOID_GAME: "VOID" },
  CODE_PENDING: { CODE_CREATED: "LOBBY_READY", VOID_GAME: "VOID" },
  LOBBY_READY: { GAME_STARTED: "PLAYING", VOID_GAME: "VOID" },
  PLAYING: {
    AWAIT_RIOT: "RESULT_PENDING",
    RIOT_RESULT: "VERIFIED",
    VOID_GAME: "VOID",
  },
  RESULT_PENDING: { RIOT_RESULT: "VERIFIED", VOID_GAME: "VOID" },
};

export function transitionCustomGame(
  state: CustomGameState,
  event: CustomGameEvent,
): CustomGameState {
  const next = TRANSITIONS[state]?.[event];
  if (next === undefined) {
    throw new Error(`Invalid custom game transition: ${state} + ${event}`);
  }
  return CustomGameStateSchema.parse(next);
}
