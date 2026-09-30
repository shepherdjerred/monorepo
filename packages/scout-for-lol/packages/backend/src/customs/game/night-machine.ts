import {
  CustomNightStateSchema,
  type CustomNightState,
} from "@scout-for-lol/data";

export type CustomNightEvent =
  | "START_PREPARING"
  | "START_DRAFT"
  | "TEAMS_LOCKED"
  | "GAME_STARTED"
  | "RIOT_RESULT"
  | "PREPARE_NEXT_GAME"
  | "END_NIGHT";

const TRANSITIONS: Readonly<
  Partial<Record<CustomNightState, Partial<Record<CustomNightEvent, string>>>>
> = {
  RECRUITING: { START_PREPARING: "PREPARING", END_NIGHT: "ENDED" },
  PREPARING: {
    START_DRAFT: "DRAFTING",
    TEAMS_LOCKED: "LOBBY_READY",
    END_NIGHT: "ENDED",
  },
  DRAFTING: { TEAMS_LOCKED: "LOBBY_READY", END_NIGHT: "ENDED" },
  LOBBY_READY: { GAME_STARTED: "PLAYING", END_NIGHT: "ENDED" },
  PLAYING: { RIOT_RESULT: "INTERMISSION", END_NIGHT: "ENDED" },
  INTERMISSION: { PREPARE_NEXT_GAME: "PREPARING", END_NIGHT: "ENDED" },
};

export function transitionCustomNight(
  state: CustomNightState,
  event: CustomNightEvent,
): CustomNightState {
  const next = TRANSITIONS[state]?.[event];
  if (next === undefined) {
    throw new Error(`Invalid custom night transition: ${state} + ${event}`);
  }
  return CustomNightStateSchema.parse(next);
}
