import type {
  CardinalDirection,
  EngineMapTile,
} from "#src/emulator/engine-observation.ts";
import type { ActionOutcomeV1 } from "./game-action-outcome.ts";
import type { GameObservationV1 } from "./game-observation.ts";

export type NavigationStopReason =
  | "target-reached"
  | "target-out-of-range"
  | "no-route"
  | "max-steps"
  | "map-changed"
  | "phase-changed"
  | "field-input-not-ready"
  | "settle-timeout";

export type NavigationOutcomeV1 = Readonly<{
  schemaVersion: 1;
  action: "navigate";
  status: "arrived" | "stopped";
  stopReason: NavigationStopReason;
  map: Readonly<{ group: number; number: number }> | null;
  target: Readonly<{ x: number; y: number }>;
  stepsTaken: number;
  before: GameObservationV1;
  after: GameObservationV1;
}>;

type NavigationOptions = Readonly<{
  observe: () => GameObservationV1;
  readMapTile: (x: number, y: number) => EngineMapTile | null;
  moveOne: (direction: CardinalDirection) => Promise<ActionOutcomeV1>;
  target: Readonly<{ x: number; y: number }>;
  maxSteps: number;
  searchRadius: number;
}>;

const DIRECTIONS: readonly Readonly<{
  direction: CardinalDirection;
  dx: number;
  dy: number;
}>[] = [
  { direction: "north", dx: 0, dy: -1 },
  { direction: "south", dx: 0, dy: 1 },
  { direction: "west", dx: -1, dy: 0 },
  { direction: "east", dx: 1, dy: 0 },
];

function coordinateKey(x: number, y: number): string {
  return `${String(x)},${String(y)}`;
}

function nextCoordinate(
  x: number,
  y: number,
  direction: CardinalDirection,
): Readonly<{ x: number; y: number }> {
  const delta = DIRECTIONS.find(
    (candidate) => candidate.direction === direction,
  );
  if (delta === undefined) {
    throw new Error(`unknown cardinal direction: ${direction}`);
  }
  return { x: x + delta.dx, y: y + delta.dy };
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

function findNextPathStep(options: {
  readMapTile: (x: number, y: number) => EngineMapTile | null;
  start: Readonly<{ x: number; y: number }>;
  target: Readonly<{ x: number; y: number }>;
  bounds: Readonly<{ minX: number; maxX: number; minY: number; maxY: number }>;
  blocked: ReadonlySet<string>;
}): CardinalDirection | null {
  const startKey = coordinateKey(options.start.x, options.start.y);
  const targetKey = coordinateKey(options.target.x, options.target.y);
  const queue: { x: number; y: number }[] = [
    { x: options.start.x, y: options.start.y },
  ];
  const firstStep = new Map<string, CardinalDirection>();
  const visited = new Set<string>([startKey]);
  let cursor = 0;

  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (current === undefined) break;
    const currentKey = coordinateKey(current.x, current.y);
    for (const candidate of DIRECTIONS) {
      const x = current.x + candidate.dx;
      const y = current.y + candidate.dy;
      if (
        x < options.bounds.minX ||
        x > options.bounds.maxX ||
        y < options.bounds.minY ||
        y > options.bounds.maxY
      ) {
        continue;
      }
      const key = coordinateKey(x, y);
      if (visited.has(key) || options.blocked.has(key)) continue;
      const tile = options.readMapTile(x, y);
      if (tile?.passable !== true) continue;
      visited.add(key);
      const initial = firstStep.get(currentKey) ?? candidate.direction;
      firstStep.set(key, initial);
      if (key === targetKey) return initial;
      queue.push({ x, y });
    }
  }
  return null;
}

function navigationResult(options: {
  stopReason: NavigationStopReason;
  target: Readonly<{ x: number; y: number }>;
  stepsTaken: number;
  before: GameObservationV1;
  after: GameObservationV1;
}): NavigationOutcomeV1 {
  return {
    schemaVersion: 1,
    action: "navigate",
    status: options.stopReason === "target-reached" ? "arrived" : "stopped",
    stopReason: options.stopReason,
    map:
      options.before.world === null
        ? null
        : {
            group: options.before.world.mapGroup,
            number: options.before.world.mapNum,
          },
    target: options.target,
    stepsTaken: options.stepsTaken,
    before: options.before,
    after: options.after,
  };
}

export async function navigateGame(
  options: NavigationOptions,
): Promise<NavigationOutcomeV1> {
  const before = options.observe();
  const start = before.world;
  if (!before.readiness.inputReady || start === null) {
    return navigationResult({
      stopReason: "field-input-not-ready",
      target: options.target,
      stepsTaken: 0,
      before,
      after: before,
    });
  }
  if (
    Math.abs(options.target.x - start.x) > options.searchRadius ||
    Math.abs(options.target.y - start.y) > options.searchRadius
  ) {
    return navigationResult({
      stopReason: "target-out-of-range",
      target: options.target,
      stepsTaken: 0,
      before,
      after: before,
    });
  }

  const bounds = {
    minX: start.x - options.searchRadius,
    maxX: start.x + options.searchRadius,
    minY: start.y - options.searchRadius,
    maxY: start.y + options.searchRadius,
  };
  const failedMovementTiles = new Set<string>();
  let stepsTaken = 0;
  let after = before;

  while (stepsTaken < options.maxSteps) {
    const current = options.observe();
    const world = current.world;
    after = current;
    if (world === null || !current.readiness.inputReady) {
      return navigationResult({
        stopReason: "field-input-not-ready",
        target: options.target,
        stepsTaken,
        before,
        after,
      });
    }
    if (mapChanged(before, current)) {
      return navigationResult({
        stopReason: "map-changed",
        target: options.target,
        stepsTaken,
        before,
        after,
      });
    }
    if (before.phase !== current.phase) {
      return navigationResult({
        stopReason: "phase-changed",
        target: options.target,
        stepsTaken,
        before,
        after,
      });
    }
    if (world.x === options.target.x && world.y === options.target.y) {
      return navigationResult({
        stopReason: "target-reached",
        target: options.target,
        stepsTaken,
        before,
        after,
      });
    }

    const blocked = new Set(failedMovementTiles);
    for (const object of world.nearby) {
      blocked.add(coordinateKey(world.x + object.dx, world.y + object.dy));
    }
    const direction = findNextPathStep({
      readMapTile: options.readMapTile,
      start: { x: world.x, y: world.y },
      target: options.target,
      bounds,
      blocked,
    });
    if (direction === null) {
      return navigationResult({
        stopReason: "no-route",
        target: options.target,
        stepsTaken,
        before,
        after,
      });
    }
    const intended = nextCoordinate(world.x, world.y, direction);
    const step = await options.moveOne(direction);
    after = step.after;
    if (
      step.stopReason === "map-changed" ||
      step.stopReason === "phase-changed" ||
      step.stopReason === "settle-timeout"
    ) {
      return navigationResult({
        stopReason: step.stopReason,
        target: options.target,
        stepsTaken,
        before,
        after,
      });
    }
    if (step.tilesMoved === 0) {
      failedMovementTiles.add(coordinateKey(intended.x, intended.y));
      continue;
    }
    stepsTaken += step.tilesMoved;
  }
  return navigationResult({
    stopReason: "max-steps",
    target: options.target,
    stepsTaken,
    before,
    after,
  });
}
