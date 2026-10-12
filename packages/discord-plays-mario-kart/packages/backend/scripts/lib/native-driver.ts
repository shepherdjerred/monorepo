// Lockstep driving for one or more SpaghettiKart instances: every step latches
// the same per-instance input, advances exactly one 30 Hz game frame, and waits
// for that frame's draws and state record. Two instances driven identically
// give a deterministic baseline to diff a single changed input against.
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Mk64RawState } from "#src/emulator/mk64-state.ts";
import { SpaghettiHost } from "#src/engine/spaghetti/host.ts";
import type { SpaghettiBuild } from "#src/engine/spaghetti/install.ts";
import {
  N64_BUTTON,
  NEUTRAL_PAD,
  type Pad,
  type StateMessage,
} from "#src/engine/spaghetti/protocol.ts";

/** A bridge STATE record, flattened. */
export type GameState = { gameFrame: number } & Mk64RawState;

export function toGameState(message: StateMessage): GameState {
  return { gameFrame: message.gameFrame, ...message.raw };
}

export type Draw = {
  drawSeq: number;
  gameFrame: number;
  latchToCaptureUs: number;
  width: number;
  height: number;
  bgra: Buffer;
};

export type StepResult = { state: GameState; draws: Draw[] };

class Instance {
  readonly host: SpaghettiHost;
  private draws: Draw[] = [];
  private latest: GameState | undefined;
  private waiter:
    { frame: number; resolve: (s: GameState) => void } | undefined;
  stepsSent = 0;

  private readonly homeDir: string;

  constructor(build: SpaghettiBuild, homeDir: string, outputFps: 30 | 60) {
    this.homeDir = homeDir;
    this.host = new SpaghettiHost({
      build,
      homeDir,
      lockstep: true,
      outputFps,
      onFrame: (f) => {
        this.draws.push({
          drawSeq: f.drawSeq,
          gameFrame: f.gameFrame,
          latchToCaptureUs: f.latchToCaptureUs,
          width: f.width,
          height: f.height,
          bgra: Buffer.from(f.bgra),
        });
      },
      onState: (message) => {
        const s = toGameState(message);
        this.latest = s;
        if (this.waiter && s.gameFrame >= this.waiter.frame) {
          const { resolve } = this.waiter;
          this.waiter = undefined;
          resolve(s);
        }
      },
    });
  }

  async start(): Promise<void> {
    // A fresh home per run: a leftover default.sav would change the menus.
    await rm(this.homeDir, { recursive: true, force: true });
    await mkdir(this.homeDir, { recursive: true });
    await this.host.start();
    // The boot path latches input once before the loop starts and emits no
    // state for it; consume that step so every later step yields one record.
    this.host.sendInput([NEUTRAL_PAD]);
    this.host.step(1);
    this.stepsSent = 1;
  }

  private waitForState(frame: number): Promise<GameState> {
    if (this.latest && this.latest.gameFrame >= frame) {
      return Promise.resolve(this.latest);
    }
    return new Promise((resolve, reject) => {
      const poll = setInterval(() => {
        const exited = this.host.exited;
        if (exited) {
          clearInterval(poll);
          this.waiter = undefined;
          reject(exited);
        }
      }, 200);
      this.waiter = {
        frame,
        resolve: (s) => {
          clearInterval(poll);
          resolve(s);
        },
      };
    });
  }

  async step(pads: readonly Pad[]): Promise<StepResult> {
    this.host.sendInput(pads);
    this.host.step(1);
    this.stepsSent++;
    const state = await this.waitForState(this.stepsSent);
    const draws = this.draws;
    this.draws = [];
    return { state, draws };
  }
}

export class LockstepGroup {
  private readonly instances: Instance[];

  constructor(
    build: SpaghettiBuild,
    runRoot: string,
    count: number,
    outputFps: 30 | 60,
  ) {
    this.instances = Array.from(
      { length: count },
      (_, i) =>
        new Instance(
          build,
          path.join(runRoot, `instance-${String(i)}`),
          outputFps,
        ),
    );
  }

  get hosts(): SpaghettiHost[] {
    return this.instances.map((i) => i.host);
  }

  async start(): Promise<void> {
    await Promise.all(this.instances.map((i) => i.start()));
  }

  /** One game frame on every instance; `pads[i]` is instance i's input. */
  async step(pads: readonly (readonly Pad[])[]): Promise<StepResult[]> {
    return Promise.all(
      this.instances.map((instance, i) => instance.step(pads[i] ?? [])),
    );
  }

  async stop(): Promise<void> {
    await Promise.all(this.instances.map((i) => i.host.stop()));
  }
}

/** gMenuSelection values (src/menus.h), same as the US cart. */
export const MENU = {
  start: 10,
  main: 11,
  characterSelect: 12,
  courseSelect: 13,
  racing: 14,
} as const;

const GAMESTATE_RACING = 4;
const RACE_STATE_RACING = 3;

export function isRacing(state: GameState): boolean {
  return (
    state.gamestate === GAMESTATE_RACING &&
    state.menuSelection === MENU.racing &&
    state.racePhase === RACE_STATE_RACING
  );
}

function seatPads(seats: number, button: number, all: boolean): Pad[] {
  return Array.from({ length: 4 }, (_, seat) =>
    seat < seats && (all || seat === 0)
      ? { button, stickX: 0, stickY: 0 }
      : NEUTRAL_PAD,
  );
}

const SETTLE_FRAMES = 20;
const TAP_PERIOD = 8;
const TAP_DOWN = 2;

/**
 * Menu policy keyed on game state, not frame timing: tap START on the title,
 * move P1 to the N-player column on game select, then tap A on every seat
 * through character and course select. Each screen waits for its fade-in, then
 * taps every 8 frames (2 down, 6 up).
 */
export function createMenuPolicy(seats: number): (state: GameState) => Pad[] {
  let lastMenu = -1;
  let framesInMenu = 0;
  return (state) => {
    if (state.menuSelection === lastMenu) {
      framesInMenu++;
    } else {
      lastMenu = state.menuSelection;
      framesInMenu = 0;
    }
    const sinceSettle = framesInMenu - SETTLE_FRAMES;
    if (sinceSettle < 0 || sinceSettle % TAP_PERIOD >= TAP_DOWN) {
      return seatPads(seats, 0, true);
    }
    const tap = Math.floor(sinceSettle / TAP_PERIOD);
    switch (state.menuSelection) {
      case MENU.start:
        return seatPads(seats, N64_BUTTON.start, false);
      case MENU.main:
        return tap < seats - 1
          ? seatPads(seats, N64_BUTTON.right, false)
          : seatPads(seats, N64_BUTTON.a, true);
      case MENU.characterSelect:
      case MENU.courseSelect:
        return seatPads(seats, N64_BUTTON.a, true);
      default:
        return seatPads(seats, 0, true);
    }
  };
}
