import type { CardinalDirection } from "#src/emulator/engine-observation.ts";
import type { CommandInput } from "#src/game/command/command-input.ts";
import type { Command } from "#src/game/command/command.ts";
import type { GameObservationV1 } from "./game-observation.ts";

export type ActionStatus =
  | "applied"
  | "blocked"
  | "context-changed"
  | "no-effect"
  | "unavailable";

export type ActionStopReason =
  | "completed"
  | "collision"
  | "map-changed"
  | "phase-changed"
  | "field-input-not-ready"
  | "no-effect"
  | "settle-timeout"
  | "wait-timeout";

export type ActionOutcomeV1 = Readonly<{
  schemaVersion: 1;
  action: string;
  status: ActionStatus;
  stopReason: ActionStopReason;
  inputApplied: boolean;
  beforeObservationId: string;
  afterObservationId: string;
  framesElapsed: number;
  tilesMoved: number;
  mapChanged: boolean;
  facingChanged: boolean;
  phaseChanged: boolean;
  before: GameObservationV1;
  after: GameObservationV1;
}>;

export type WaitCondition = "ready" | "stable" | "phase-change";

export type GameControlPort = {
  observe: () => GameObservationV1;
  press: (command: CommandInput) => Promise<void>;
  waitFrames: (frames: number) => Promise<void>;
};

type SettleResult = Readonly<{
  observation: GameObservationV1;
  timedOut: boolean;
}>;

const SETTLE_STEP_FRAMES = 2;
const SETTLE_MAX_FRAMES = 60;
const SETTLE_STABLE_READS = 2;

function directionCommand(direction: CardinalDirection): Command {
  switch (direction) {
    case "north":
      return "up";
    case "south":
      return "down";
    case "west":
      return "left";
    case "east":
      return "right";
  }
}

function sameWorldPosition(
  left: GameObservationV1,
  right: GameObservationV1,
): boolean {
  if (left.world === null || right.world === null) {
    return left.world === right.world;
  }
  return (
    left.world.mapGroup === right.world.mapGroup &&
    left.world.mapNum === right.world.mapNum &&
    left.world.x === right.world.x &&
    left.world.y === right.world.y
  );
}

function mapChanged(
  before: GameObservationV1,
  after: GameObservationV1,
): boolean {
  if (before.world === null || after.world === null) return false;
  return (
    before.world.mapGroup !== after.world.mapGroup ||
    before.world.mapNum !== after.world.mapNum
  );
}

function tilesMoved(
  before: GameObservationV1,
  after: GameObservationV1,
): number {
  if (
    before.world === null ||
    after.world === null ||
    mapChanged(before, after)
  ) {
    return 0;
  }
  return (
    Math.abs(after.world.x - before.world.x) +
    Math.abs(after.world.y - before.world.y)
  );
}

function facingChanged(
  before: GameObservationV1,
  after: GameObservationV1,
): boolean {
  return (
    before.world !== null &&
    after.world !== null &&
    before.world.facing !== after.world.facing
  );
}

function stableSignature(observation: GameObservationV1): string {
  const world = observation.world;
  return JSON.stringify({
    phase: observation.phase,
    inputReady: observation.readiness.inputReady,
    playerStable: observation.readiness.playerStable,
    mapGroup: world?.mapGroup ?? null,
    mapNum: world?.mapNum ?? null,
    x: world?.x ?? null,
    y: world?.y ?? null,
    facing: world?.facing ?? null,
    transition: world?.tileTransitionState ?? null,
  });
}

function collisionProvesBlocked(
  direction: CardinalDirection | undefined,
  before: GameObservationV1,
  after: GameObservationV1,
): boolean {
  if (
    direction === undefined ||
    before.world === null ||
    after.world === null ||
    !sameWorldPosition(before, after) ||
    after.world.facing !== direction
  ) {
    return false;
  }
  return !after.world.collision[direction].passable;
}

export function actionOutcome(
  action: string,
  before: GameObservationV1,
  after: GameObservationV1,
  options: Readonly<{
    inputApplied: boolean;
    direction?: CardinalDirection;
    settleTimedOut?: boolean;
  }>,
): ActionOutcomeV1 {
  const didMapChange = mapChanged(before, after);
  const didPhaseChange = before.phase !== after.phase;
  const didMove = tilesMoved(before, after);
  const didFaceChange = facingChanged(before, after);
  const blocked = collisionProvesBlocked(options.direction, before, after);

  let status: ActionStatus;
  let stopReason: ActionStopReason;
  if (!options.inputApplied) {
    status = "unavailable";
    stopReason = "field-input-not-ready";
  } else if (didMapChange) {
    status = "context-changed";
    stopReason = "map-changed";
  } else if (didPhaseChange) {
    status = "context-changed";
    stopReason = "phase-changed";
  } else if (blocked) {
    status = "blocked";
    stopReason = "collision";
  } else if (options.settleTimedOut === true) {
    status = "applied";
    stopReason = "settle-timeout";
  } else if (didMove > 0 || didFaceChange) {
    status = "applied";
    stopReason = "completed";
  } else {
    status = "no-effect";
    stopReason = "no-effect";
  }

  return {
    schemaVersion: 1,
    action,
    status,
    stopReason,
    inputApplied: options.inputApplied,
    beforeObservationId: before.id,
    afterObservationId: after.id,
    framesElapsed: Math.max(0, after.frame - before.frame),
    tilesMoved: didMove,
    mapChanged: didMapChange,
    facingChanged: didFaceChange,
    phaseChanged: didPhaseChange,
    before,
    after,
  };
}

export class GameController {
  private locked = false;
  private readonly lockWaiters: (() => void)[] = [];

  constructor(private readonly port: GameControlPort) {}

  observe(): GameObservationV1 {
    return this.port.observe();
  }

  async perform(
    action: string,
    operation: () => Promise<void>,
  ): Promise<ActionOutcomeV1> {
    return await this.exclusive(async () => {
      const before = this.port.observe();
      await operation();
      const settled = await this.settle();
      return actionOutcome(action, before, settled.observation, {
        inputApplied: true,
        settleTimedOut: settled.timedOut,
      });
    });
  }

  async tap(command: Command, repeat = 1): Promise<ActionOutcomeV1> {
    return await this.exclusive(async () => {
      const before = this.port.observe();
      let after = before;
      let settleTimedOut = false;
      for (let index = 0; index < repeat; index += 1) {
        await this.port.press({ command, quantity: 1 });
        const settled = await this.settle();
        after = settled.observation;
        settleTimedOut ||= settled.timedOut;
        if (
          before.phase !== after.phase ||
          mapChanged(before, after) ||
          settleTimedOut
        ) {
          break;
        }
      }
      return actionOutcome(`tap:${command}`, before, after, {
        inputApplied: true,
        settleTimedOut,
      });
    });
  }

  async move(
    direction: CardinalDirection,
    requestedTiles = 1,
  ): Promise<ActionOutcomeV1> {
    return await this.exclusive(async () => {
      const before = this.port.observe();
      if (!before.readiness.inputReady || before.world === null) {
        return actionOutcome(`move:${direction}`, before, before, {
          inputApplied: false,
          direction,
        });
      }

      let after = before;
      let settleTimedOut = false;
      let completedTiles = 0;
      while (completedTiles < requestedTiles) {
        const stepBefore = this.port.observe();
        if (!stepBefore.readiness.inputReady || stepBefore.world === null)
          break;

        await this.port.press({
          command: directionCommand(direction),
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
            command: directionCommand(direction),
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

      return actionOutcome(`move:${direction}`, before, after, {
        inputApplied: true,
        direction,
        settleTimedOut,
      });
    });
  }

  async interact(direction?: CardinalDirection): Promise<ActionOutcomeV1> {
    return await this.exclusive(async () => {
      const before = this.port.observe();
      let after: GameObservationV1;
      let settleTimedOut = false;

      if (
        direction !== undefined &&
        before.world !== null &&
        before.world.facing !== direction
      ) {
        if (!before.readiness.inputReady) {
          return actionOutcome("interact", before, before, {
            inputApplied: false,
            direction,
          });
        }
        await this.port.press({
          command: directionCommand(direction),
          quantity: 1,
        });
        const turn = await this.settle();
        after = turn.observation;
        settleTimedOut ||= turn.timedOut;
        if (
          after.phase !== before.phase ||
          mapChanged(before, after) ||
          after.world?.facing !== direction
        ) {
          return actionOutcome("interact", before, after, {
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
      return actionOutcome("interact", before, after, {
        inputApplied: true,
        settleTimedOut,
      });
    });
  }

  async waitFor(
    condition: WaitCondition,
    maxFrames: number,
  ): Promise<ActionOutcomeV1> {
    return await this.exclusive(async () => {
      const before = this.port.observe();
      let after = before;
      let elapsed = 0;
      while (elapsed < maxFrames) {
        if (this.conditionMet(condition, before, after)) {
          return actionOutcome(`wait:${condition}`, before, after, {
            inputApplied: true,
          });
        }
        await this.port.waitFrames(SETTLE_STEP_FRAMES);
        elapsed += SETTLE_STEP_FRAMES;
        after = this.port.observe();
      }
      const base = actionOutcome(`wait:${condition}`, before, after, {
        inputApplied: true,
      });
      return { ...base, stopReason: "wait-timeout" };
    });
  }

  private conditionMet(
    condition: WaitCondition,
    before: GameObservationV1,
    current: GameObservationV1,
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
