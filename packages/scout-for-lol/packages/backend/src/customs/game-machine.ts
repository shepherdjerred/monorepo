import { createActor, setup } from "xstate";
import {
  CustomGameStateSchema,
  type CustomGameState,
} from "@scout-for-lol/data";

export type CustomGameEvent =
  | { type: "CAPTAINS_SELECTED" }
  | { type: "START_DRAFT" }
  | { type: "TEAMS_LOCKED" }
  | { type: "CODE_CREATED" }
  | { type: "GAME_STARTED" }
  | { type: "AWAIT_RESULT" }
  | { type: "RIOT_RESULT" }
  | { type: "MANUAL_RESULT" }
  | { type: "VOID_GAME" };

type CustomGameContext = Record<string, never>;

const machineTypes: {
  context: CustomGameContext;
  events: CustomGameEvent;
} = {
  context: {},
  events: { type: "VOID_GAME" },
};

export const customGameMachine = setup({ types: machineTypes }).createMachine({
  id: "customGame",
  initial: "ROSTER_OPEN",
  context: {},
  states: {
    ROSTER_OPEN: {
      on: { CAPTAINS_SELECTED: "CAPTAINS_SET", VOID_GAME: "VOID" },
    },
    CAPTAINS_SET: {
      on: {
        START_DRAFT: "DRAFTING",
        TEAMS_LOCKED: "CODE_PENDING",
        VOID_GAME: "VOID",
      },
    },
    DRAFTING: {
      on: { TEAMS_LOCKED: "CODE_PENDING", VOID_GAME: "VOID" },
    },
    CODE_PENDING: {
      on: { CODE_CREATED: "LOBBY_READY", VOID_GAME: "VOID" },
    },
    LOBBY_READY: {
      on: { GAME_STARTED: "PLAYING", VOID_GAME: "VOID" },
    },
    PLAYING: {
      on: {
        AWAIT_RESULT: "RESULT_PENDING",
        RIOT_RESULT: "VERIFIED",
        VOID_GAME: "VOID",
      },
    },
    RESULT_PENDING: {
      on: {
        RIOT_RESULT: "VERIFIED",
        MANUAL_RESULT: "MANUAL",
        VOID_GAME: "VOID",
      },
    },
    MANUAL: {
      on: { RIOT_RESULT: "VERIFIED" },
    },
    VERIFIED: { type: "final" },
    VOID: { type: "final" },
  },
});

export function transitionCustomGame(
  state: CustomGameState,
  event: CustomGameEvent,
): CustomGameState {
  const resolved = customGameMachine.resolveState({
    value: state,
    context: {},
  });
  const actor = createActor(customGameMachine, { snapshot: resolved });
  actor.start();
  actor.send(event);
  const next = CustomGameStateSchema.parse(actor.getSnapshot().value);
  actor.stop();
  if (next === state) {
    throw new Error(`Invalid custom game transition: ${state} + ${event.type}`);
  }
  return next;
}
