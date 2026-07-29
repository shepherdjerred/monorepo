import type {
  CardinalDirection,
  EngineMapTile,
} from "#src/emulator/engine-observation.ts";
import type { CommandInput } from "#src/game/command/command-input.ts";
import type { Command } from "#src/game/command/command.ts";
import type { GameObservationV2 } from "./game-observation.ts";
import { commandForDirection } from "./game-direction.ts";
import { navigateGame, type NavigationOutcomeV1 } from "./game-navigation.ts";
import {
  actionOutcome,
  collisionProvesBlocked,
  mapChanged,
  meaningfulStateSignature,
  tilesMoved,
  visualChangeRatio,
  type ActionOutcomeOptions,
  type ActionOutcomeV1,
} from "./game-action-outcome.ts";

export type WaitCondition = "ready" | "stable" | "phase-change";

export type GameControlPort = {
  observe: () => GameObservationV2;
  renderFrame: () => Uint8Array;
  press: (command: CommandInput) => Promise<void>;
  waitFrames: (frames: number) => Promise<void>;
  readMapTile: (x: number, y: number) => EngineMapTile | null;
};

type ControlSnapshot = Readonly<{
  observation: GameObservationV2;
  frame: Uint8Array;
}>;

type SettleResult = Readonly<{
  observation: GameObservationV2;
  timedOut: boolean;
}>;

const SETTLE_STEP_FRAMES = 2;
const SETTLE_MAX_FRAMES = 60;
const SETTLE_STABLE_READS = 2;

function stableSignature(observation: GameObservationV2): string {
  return meaningfulStateSignature(observation);
}

function interactionReady(observation: GameObservationV2): boolean {
  return (
    observation.phase === "overworld" &&
    observation.world !== null &&
    observation.readiness.inputReady &&
    observation.readiness.playerStable
  );
}

export class GameController {
  private locked = false;
  private readonly lockWaiters: (() => void)[] = [];

  constructor(private readonly port: GameControlPort) {}

  observe(): GameObservationV2 {
    return this.port.observe();
  }

  async perform(
    action: string,
    operation: () => Promise<void>,
  ): Promise<ActionOutcomeV1> {
    return await this.exclusive(async () => {
      const before = this.capture();
      await operation();
      const settled = await this.settle();
      return this.outcome(action, before, settled.observation, {
        inputApplied: true,
        settleTimedOut: settled.timedOut,
      });
    });
  }

  async tap(command: Command, repeat = 1): Promise<ActionOutcomeV1> {
    return await this.exclusive(async () => {
      const before = this.capture();
      let after = before.observation;
      let settleTimedOut = false;
      for (let index = 0; index < repeat; index += 1) {
        await this.port.press({ command, quantity: 1 });
        const settled = await this.settle();
        after = settled.observation;
        settleTimedOut ||= settled.timedOut;
        if (
          before.observation.phase !== after.phase ||
          mapChanged(before.observation, after) ||
          settleTimedOut
        ) {
          break;
        }
      }
      return this.outcome(`tap:${command}`, before, after, {
        inputApplied: true,
        settleTimedOut,
      });
    });
  }

  async move(
    direction: CardinalDirection,
    requestedTiles = 1,
  ): Promise<ActionOutcomeV1> {
    return await this.exclusive(
      async () => await this.moveUnlocked(direction, requestedTiles),
    );
  }

  async navigate(
    target: Readonly<{ x: number; y: number }>,
    maxSteps = 64,
    searchRadius = 12,
  ): Promise<NavigationOutcomeV1> {
    return await this.exclusive(
      async () =>
        await navigateGame({
          observe: () => this.port.observe(),
          readMapTile: (x, y) => this.port.readMapTile(x, y),
          moveOne: async (direction) => await this.moveUnlocked(direction, 1),
          target,
          maxSteps,
          searchRadius,
        }),
    );
  }

  async interact(direction?: CardinalDirection): Promise<ActionOutcomeV1> {
    return await this.exclusive(async () => {
      const before = this.capture();
      const beforeObservation = before.observation;
      let after: GameObservationV2;
      let settleTimedOut = false;

      if (!interactionReady(beforeObservation)) {
        const options: ActionOutcomeOptions =
          direction === undefined
            ? { inputApplied: false }
            : { inputApplied: false, direction };
        return this.outcome("interact", before, beforeObservation, options);
      }

      if (
        direction !== undefined &&
        beforeObservation.world !== null &&
        beforeObservation.world.facing !== direction
      ) {
        await this.port.press({
          command: commandForDirection(direction),
          quantity: 1,
        });
        const turn = await this.settle();
        after = turn.observation;
        settleTimedOut ||= turn.timedOut;
        if (
          !interactionReady(after) ||
          after.phase !== beforeObservation.phase ||
          mapChanged(beforeObservation, after) ||
          after.world?.facing !== direction
        ) {
          return this.outcome("interact", before, after, {
            inputApplied: true,
            direction,
            settleTimedOut,
          });
        }
      }

      await this.port.press({ command: "a", quantity: 1 });
      const settled = await this.settle();
      after = settled.observation;
      settleTimedOut ||= settled.timedOut;
      return this.outcome("interact", before, after, {
        inputApplied: true,
        settleTimedOut,
      });
    });
  }

  async advance(): Promise<ActionOutcomeV1> {
    return await this.exclusive(async () => {
      const before = this.capture();
      if (!before.observation.context.dialogInputReady) {
        return this.outcome("advance", before, before.observation, {
          inputApplied: false,
          unavailableReason: "dialog-not-ready",
        });
      }
      await this.port.press({ command: "a", quantity: 1 });
      const settled = await this.settle();
      return this.outcome("advance", before, settled.observation, {
        inputApplied: true,
        settleTimedOut: settled.timedOut,
      });
    });
  }

  async waitFor(
    condition: WaitCondition,
    maxFrames: number,
  ): Promise<ActionOutcomeV1> {
    return await this.exclusive(async () => {
      const before = this.capture();
      let after = before.observation;
      let elapsed = 0;
      while (elapsed < maxFrames) {
        if (this.conditionMet(condition, before.observation, after)) {
          const base = this.outcome(`wait:${condition}`, before, after, {
            inputApplied: true,
          });
          return {
            ...base,
            status: "applied",
            stopReason: "completed",
          };
        }
        await this.port.waitFrames(SETTLE_STEP_FRAMES);
        elapsed += SETTLE_STEP_FRAMES;
        after = this.port.observe();
      }
      const base = this.outcome(`wait:${condition}`, before, after, {
        inputApplied: true,
      });
      return { ...base, stopReason: "wait-timeout" };
    });
  }

  private async moveUnlocked(
    direction: CardinalDirection,
    requestedTiles: number,
  ): Promise<ActionOutcomeV1> {
    const before = this.capture();
    const beforeObservation = before.observation;
    if (
      !beforeObservation.readiness.inputReady ||
      beforeObservation.world === null
    ) {
      return this.outcome(`move:${direction}`, before, beforeObservation, {
        inputApplied: false,
        direction,
      });
    }

    let after = beforeObservation;
    let settleTimedOut = false;
    let completedTiles = 0;
    while (completedTiles < requestedTiles) {
      const stepBefore = this.port.observe();
      if (!stepBefore.readiness.inputReady || stepBefore.world === null) break;

      await this.port.press({
        command: commandForDirection(direction),
        quantity: 1,
      });
      let settled = await this.settle();
      after = settled.observation;
      settleTimedOut ||= settled.timedOut;

      if (
        mapChanged(stepBefore, after) ||
        stepBefore.phase !== after.phase ||
        settleTimedOut
      ) {
        break;
      }

      let stepDistance = tilesMoved(stepBefore, after);
      if (
        stepDistance === 0 &&
        after.world !== null &&
        after.world.facing === direction &&
        !collisionProvesBlocked(direction, stepBefore, after)
      ) {
        await this.port.press({
          command: commandForDirection(direction),
          quantity: 1,
        });
        settled = await this.settle();
        after = settled.observation;
        settleTimedOut ||= settled.timedOut;
        stepDistance = tilesMoved(stepBefore, after);
      }

      if (stepDistance === 0) break;
      completedTiles += stepDistance;
      if (
        mapChanged(stepBefore, after) ||
        stepBefore.phase !== after.phase ||
        !after.readiness.inputReady
      ) {
        break;
      }
    }

    return this.outcome(`move:${direction}`, before, after, {
      inputApplied: true,
      direction,
      settleTimedOut,
    });
  }

  private capture(): ControlSnapshot {
    return {
      observation: this.port.observe(),
      frame: this.port.renderFrame(),
    };
  }

  private outcome(
    action: string,
    before: ControlSnapshot,
    after: GameObservationV2,
    options: ActionOutcomeOptions,
  ): ActionOutcomeV1 {
    return actionOutcome(action, before.observation, after, {
      ...options,
      visualChangeRatio: visualChangeRatio(
        before.frame,
        this.port.renderFrame(),
      ),
    });
  }

  private conditionMet(
    condition: WaitCondition,
    before: GameObservationV2,
    current: GameObservationV2,
  ): boolean {
    switch (condition) {
      case "ready":
        return current.readiness.inputReady;
      case "stable":
        return current.readiness.playerStable;
      case "phase-change":
        return current.phase !== before.phase;
    }
  }

  private async settle(): Promise<SettleResult> {
    let previous = this.port.observe();
    let stableReads = 0;
    let elapsed = 0;
    while (elapsed < SETTLE_MAX_FRAMES) {
      await this.port.waitFrames(SETTLE_STEP_FRAMES);
      elapsed += SETTLE_STEP_FRAMES;
      const current = this.port.observe();
      if (
        current.readiness.playerStable &&
        stableSignature(previous) === stableSignature(current)
      ) {
        stableReads += 1;
        if (stableReads >= SETTLE_STABLE_READS) {
          return { observation: current, timedOut: false };
        }
      } else {
        stableReads = 0;
      }
      previous = current;
    }
    return { observation: previous, timedOut: true };
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    const gate = Promise.withResolvers<undefined>();
    this.lockWaiters.push(() => {
      gate.resolve();
    });
    await gate.promise;
  }

  private release(): void {
    const next = this.lockWaiters.shift();
    if (next === undefined) {
      this.locked = false;
      return;
    }
    next();
  }
}
