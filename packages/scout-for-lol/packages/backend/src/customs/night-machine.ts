import { createActor, setup } from "xstate";
import {
  CustomNightStateSchema,
  type CustomNightState,
} from "@scout-for-lol/data";

export type CustomNightEvent =
  | { type: "START_PREPARING" }
  | { type: "START_DRAFT" }
  | { type: "TEAMS_LOCKED" }
  | { type: "GAME_STARTED" }
  | { type: "INTERMISSION_OPENED" }
  | { type: "PREPARE_NEXT_GAME" }
  | { type: "END_NIGHT" };

type CustomNightContext = Record<string, never>;

const machineTypes: {
  context: CustomNightContext;
  events: CustomNightEvent;
} = {
  context: {},
  events: { type: "END_NIGHT" },
};

export const customNightMachine = setup({ types: machineTypes }).createMachine({
  id: "customNight",
  initial: "RECRUITING",
  context: {},
  on: {
    END_NIGHT: ".ENDED",
  },
  states: {
    RECRUITING: {
      on: { START_PREPARING: "PREPARING" },
    },
    PREPARING: {
      on: { START_DRAFT: "DRAFTING", TEAMS_LOCKED: "LOBBY_READY" },
    },
    DRAFTING: {
      on: { TEAMS_LOCKED: "LOBBY_READY" },
    },
    LOBBY_READY: {
      on: { GAME_STARTED: "PLAYING" },
    },
    PLAYING: {
      on: { INTERMISSION_OPENED: "INTERMISSION" },
    },
    INTERMISSION: {
      on: { PREPARE_NEXT_GAME: "PREPARING" },
    },
    ENDED: { type: "final" },
  },
});

export function transitionCustomNight(
  state: CustomNightState,
  event: CustomNightEvent,
): CustomNightState {
  const resolved = customNightMachine.resolveState({
    value: state,
    context: {},
  });
  const actor = createActor(customNightMachine, { snapshot: resolved });
  actor.start();
  actor.send(event);
  const next = CustomNightStateSchema.parse(actor.getSnapshot().value);
  actor.stop();
  if (next === state) {
    throw new Error(
      `Invalid custom night transition: ${state} + ${event.type}`,
    );
  }
  return next;
}
