// Named MK64 scenarios that drive the game from boot to a known state via a
// deterministic, frame-keyed input schedule. Validated in-emulator against the
// US ROM (2026-06-13). Add a scenario by adding an entry to SCENARIOS.
//
// Menu-nav recipe (the non-obvious part): tap START a few times to reach the
// GAME SELECT screen, press RIGHT (seats-1) times to move P1 from the 1P column
// to the N-player column, then mirror A onto ALL seats — character select
// blocks until every player confirms — through course select into racing.
import { EMPTY_BUTTONS } from "@discord-plays-mario-kart/common";
import type {
  ButtonState,
  PlayerInputState,
} from "@discord-plays-mario-kart/common";
import type { Mk64Snapshot } from "#src/emulator/mk64-memory.ts";
import type { FrameSchedule } from "./harness.ts";

/** A held-input window. `seats: "p1"` = only P1 (menu nav); "all" = every seat. */
type Press = {
  from: number;
  to: number;
  keys: Partial<ButtonState>;
  seats: "all" | "p1";
};

export type Scenario = {
  description: string;
  seats: number;
  schedule: FrameSchedule;
  until: (snapshot: Mk64Snapshot, frame: number) => boolean;
  timeoutFrames: number;
  /** Screen mode the scenario ends in (for the name overlay on --shot). */
  screenMode: Mk64Snapshot["screenMode"];
};

function pressesToSchedule(presses: Press[], seats: number): FrameSchedule {
  return (frame) => {
    const inputs: PlayerInputState[] = [];
    for (let seat = 0; seat < seats; seat++) {
      let buttons: ButtonState = { ...EMPTY_BUTTONS };
      for (const press of presses) {
        if (frame < press.from || frame > press.to) continue;
        if (press.seats === "p1" && seat !== 0) continue;
        buttons = { ...buttons, ...press.keys };
      }
      inputs.push({ buttons, analogX: 0, analogY: 0 });
    }
    return inputs;
  };
}

// Tap START repeatedly to walk title → press-start → GAME SELECT.
const START_TAPS: Press[] = [
  { from: 320, to: 335, keys: { start: true }, seats: "p1" },
  { from: 380, to: 395, keys: { start: true }, seats: "p1" },
  { from: 440, to: 455, keys: { start: true }, seats: "p1" },
  { from: 500, to: 515, keys: { start: true }, seats: "p1" },
  { from: 560, to: 575, keys: { start: true }, seats: "p1" },
];

// One RIGHT tap moves P1 one column right (1P → 2P → 3P → 4P).
function rightTaps(count: number): Press[] {
  const taps: Press[] = [];
  for (let i = 0; i < count; i++) {
    const from = 850 + i * 60;
    taps.push({ from, to: from + 15, keys: { right: true }, seats: "p1" });
  }
  return taps;
}

// Mash A on every seat to confirm characters (all players) → course → race.
function confirmTaps(): Press[] {
  const taps: Press[] = [];
  for (let from = 1080; from <= 2200; from += 70) {
    taps.push({ from, to: from + 10, keys: { a: true }, seats: "all" });
  }
  return taps;
}

const RACE_CAPTURE_FRAME = 2300; // a bit into the race so karts have spread out
const RACE_TIMEOUT = 3600;

function raceScenario(
  seats: number,
  screenMode: Scenario["screenMode"],
): Scenario {
  const presses: Press[] = [
    ...START_TAPS,
    ...rightTaps(seats - 1),
    ...confirmTaps(),
  ];
  return {
    description: `Drive ${String(seats)} player(s) into a race (${screenMode})`,
    seats,
    schedule: pressesToSchedule(presses, seats),
    until: (snap, frame) =>
      snap.raceState === "racing" && frame >= RACE_CAPTURE_FRAME,
    timeoutFrames: RACE_TIMEOUT,
    screenMode,
  };
}

export const SCENARIOS: Record<string, Scenario> = {
  // Boot to the GAME SELECT menu (for inspecting menu screens).
  menu: {
    description: "Boot to the GAME SELECT menu",
    seats: 1,
    schedule: pressesToSchedule(START_TAPS, 1),
    until: (_snap, frame) => frame >= 900,
    timeoutFrames: 1400,
    screenMode: "1p",
  },
  "1p": raceScenario(1, "1p"),
  "2p": raceScenario(2, "2p-horizontal"),
  "3p": raceScenario(3, "quad"),
  "4p": raceScenario(4, "quad"),
};
