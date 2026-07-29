import type { CardinalDirection } from "#src/emulator/engine-observation.ts";
import type { GameObservationV2 } from "./game-observation.ts";

type ActionStatus =
  | "applied"
  | "blocked"
  | "context-changed"
  | "no-effect"
  | "unavailable";

type ActionStopReason =
  | "completed"
  | "collision"
  | "map-changed"
  | "phase-changed"
  | "field-input-not-ready"
  | "dialog-not-ready"
  | "no-effect"
  | "settle-timeout"
  | "wait-timeout";

export type ActionOutcomeOptions = Readonly<{
  inputApplied: boolean;
  direction?: CardinalDirection;
  settleTimedOut?: boolean;
  unavailableReason?: Extract<
    ActionStopReason,
    "field-input-not-ready" | "dialog-not-ready"
  >;
  visualChangeRatio?: number;
}>;

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
  battleChanged: boolean;
  stateChanged: boolean;
  visualChanged: boolean;
  visualChangeRatio: number;
  before: GameObservationV2;
  after: GameObservationV2;
}>;

const MIN_VISUAL_CHANGE_RATIO = 0.0025;
const MIN_COLOR_CHANNEL_DELTA = 16;

export function mapChanged(
  before: GameObservationV2,
  after: GameObservationV2,
): boolean {
  if (before.world === null || after.world === null) return false;
  return (
    before.world.mapGroup !== after.world.mapGroup ||
    before.world.mapNum !== after.world.mapNum
  );
}

export function tilesMoved(
  before: GameObservationV2,
  after: GameObservationV2,
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

export function collisionProvesBlocked(
  direction: CardinalDirection | undefined,
  before: GameObservationV2,
  after: GameObservationV2,
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

export function meaningfulStateSignature(
  observation: GameObservationV2,
): string {
  return JSON.stringify({
    phase: observation.phase,
    context: observation.context,
    readiness: observation.readiness,
    battle: observation.battle,
    world: observation.world,
    game: observation.game,
  });
}

export function visualChangeRatio(
  before: Uint8Array,
  after: Uint8Array,
): number {
  if (before.length !== after.length) return 1;
  const pixelCount = Math.floor(before.length / 4);
  if (pixelCount === 0) return 0;

  let changedPixels = 0;
  for (let offset = 0; offset < pixelCount * 4; offset += 4) {
    if (
      Math.abs((before[offset] ?? 0) - (after[offset] ?? 0)) >=
        MIN_COLOR_CHANNEL_DELTA ||
      Math.abs((before[offset + 1] ?? 0) - (after[offset + 1] ?? 0)) >=
        MIN_COLOR_CHANNEL_DELTA ||
      Math.abs((before[offset + 2] ?? 0) - (after[offset + 2] ?? 0)) >=
        MIN_COLOR_CHANNEL_DELTA
    ) {
      changedPixels += 1;
    }
  }
  return changedPixels / pixelCount;
}

export function actionOutcome(
  action: string,
  before: GameObservationV2,
  after: GameObservationV2,
  options: ActionOutcomeOptions,
): ActionOutcomeV1 {
  const didMapChange = mapChanged(before, after);
  const didPhaseChange = before.phase !== after.phase;
  const didMove = tilesMoved(before, after);
  const didFaceChange = facingChanged(before, after);
  const didBattleChange =
    JSON.stringify(before.battle) !== JSON.stringify(after.battle);
  const didStateChange =
    meaningfulStateSignature(before) !== meaningfulStateSignature(after);
  const visualRatio = options.visualChangeRatio ?? 0;
  const didVisualChange = visualRatio >= MIN_VISUAL_CHANGE_RATIO;
  const blocked = collisionProvesBlocked(options.direction, before, after);

  let status: ActionStatus;
  let stopReason: ActionStopReason;
  if (!options.inputApplied) {
    status = "unavailable";
    stopReason = options.unavailableReason ?? "field-input-not-ready";
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
  } else if (
    didMove > 0 ||
    didFaceChange ||
    didStateChange ||
    didVisualChange
  ) {
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
    battleChanged: didBattleChange,
    stateChanged: didStateChange,
    visualChanged: didVisualChange,
    visualChangeRatio: visualRatio,
    before,
    after,
  };
}

function sameWorldPosition(
  left: GameObservationV2,
  right: GameObservationV2,
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

function facingChanged(
  before: GameObservationV2,
  after: GameObservationV2,
): boolean {
  return (
    before.world !== null &&
    after.world !== null &&
    before.world.facing !== after.world.facing
  );
}
