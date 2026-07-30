import type { CardinalDirection } from "#src/emulator/engine-observation.ts";
import type { EngineMapTopologyV1 } from "#src/emulator/engine-map-topology.ts";
import type { ActionOutcomeV1 } from "./game-action-outcome.ts";
import {
  competingAutomaticWarpEdges,
  coordinateKey,
  mapMatchesTopology,
  movementEdgeKey,
  occupiedTiles,
  reachedSelectedSameMapWarpLanding,
} from "./game-exit-navigation-blocks.ts";
import type { GameObservationV2 } from "./game-observation.ts";
import type {
  ExitNavigationOutcomeV1,
  ExitNavigationStopReason,
} from "./game-exit-navigation-types.ts";

type ExitActivation = Readonly<{
  approach: Readonly<{ x: number; y: number }>;
  direction: CardinalDirection;
  trigger: Readonly<{ x: number; y: number; elevation: number }> | null;
}>;

type ExitPathStep = Readonly<{
  direction: CardinalDirection | null;
  activation: ExitActivation;
}>;

type ExitNavigationOptions = Readonly<{
  observe: () => GameObservationV2;
  readMapTile: (x: number, y: number) => Readonly<{ passable: boolean }> | null;
  moveOne: (direction: CardinalDirection) => Promise<ActionOutcomeV1>;
  topology: EngineMapTopologyV1 | null;
  exitId: string;
  maxSteps: number;
}>;

const ELEVATION_TRANSITION = 0;
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

function delta(direction: CardinalDirection): Readonly<{
  dx: number;
  dy: number;
}> {
  const value = DIRECTIONS.find(
    (candidate) => candidate.direction === direction,
  );
  if (value === undefined) {
    throw new RangeError(`unknown cardinal direction: ${direction}`);
  }
  return value;
}

function nextCoordinate(
  x: number,
  y: number,
  direction: CardinalDirection,
): Readonly<{ x: number; y: number }> {
  const movement = delta(direction);
  return { x: x + movement.dx, y: y + movement.dy };
}

function inBounds(
  topology: EngineMapTopologyV1,
  coordinate: Readonly<{ x: number; y: number }>,
): boolean {
  return (
    coordinate.x >= topology.bounds.minX &&
    coordinate.x <= topology.bounds.maxX &&
    coordinate.y >= topology.bounds.minY &&
    coordinate.y <= topology.bounds.maxY
  );
}

function connectionActivations(
  topology: EngineMapTopologyV1,
  index: number,
): readonly ExitActivation[] | null {
  const connection = topology.connections.find(
    (candidate) => candidate.index === index,
  );
  if (connection === undefined) return null;
  if (
    connection.span === null ||
    connection.direction === "dive" ||
    connection.direction === "emerge"
  ) {
    return [];
  }
  const xStep =
    connection.span.start.x === connection.span.end.x
      ? 0
      : connection.span.start.x < connection.span.end.x
        ? 1
        : -1;
  const yStep =
    connection.span.start.y === connection.span.end.y
      ? 0
      : connection.span.start.y < connection.span.end.y
        ? 1
        : -1;
  if (xStep !== 0 && yStep !== 0) {
    throw new Error("map connection span must be horizontal or vertical");
  }
  const activations: ExitActivation[] = [];
  let x = connection.span.start.x;
  let y = connection.span.start.y;
  for (;;) {
    const approach = { x, y };
    if (!inBounds(topology, approach)) {
      throw new Error("map connection span falls outside topology bounds");
    }
    activations.push({
      approach,
      direction: connection.direction,
      trigger: null,
    });
    if (x === connection.span.end.x && y === connection.span.end.y) break;
    x += xStep;
    y += yStep;
  }
  return activations;
}

function warpActivations(
  topology: EngineMapTopologyV1,
  index: number,
): readonly ExitActivation[] | null {
  const warp = topology.warps.find((candidate) => candidate.index === index);
  if (warp === undefined) return null;
  if (warp.activation === "unsupported") return [];
  if (!inBounds(topology, warp.trigger)) {
    throw new Error("map warp trigger falls outside topology bounds");
  }
  if (warp.activation !== "step") {
    const movement = delta(warp.activation);
    const approach = {
      x: warp.trigger.x - movement.dx,
      y: warp.trigger.y - movement.dy,
    };
    return inBounds(topology, approach)
      ? [{ approach, direction: warp.activation, trigger: warp.trigger }]
      : [];
  }
  const activations: ExitActivation[] = [];
  for (const candidate of DIRECTIONS) {
    const approach = {
      x: warp.trigger.x - candidate.dx,
      y: warp.trigger.y - candidate.dy,
    };
    if (!inBounds(topology, approach)) continue;
    activations.push({
      approach,
      direction: candidate.direction,
      trigger: warp.trigger,
    });
  }
  return activations;
}

function exitActivations(
  topology: EngineMapTopologyV1,
  exitId: string,
): readonly ExitActivation[] | null {
  const match = /^(connection|warp):(0|[1-9]\d*)$/u.exec(exitId);
  if (match === null) return null;
  const kind = match[1];
  const rawIndex = match[2];
  if (rawIndex === undefined) return null;
  const index = Number.parseInt(rawIndex, 10);
  return kind === "connection"
    ? connectionActivations(topology, index)
    : warpActivations(topology, index);
}

function exitResult(options: {
  exitId: string;
  stopReason: ExitNavigationStopReason;
  attemptsMade: number;
  stepsTaken: number;
  before: GameObservationV2;
  after: GameObservationV2;
}): ExitNavigationOutcomeV1 {
  return {
    schemaVersion: 1,
    action: "navigate-exit",
    exitId: options.exitId,
    status:
      options.stopReason === "exit-traversed"
        ? "traversed"
        : options.stopReason === "exit-triggered"
          ? "triggered"
          : "stopped",
    stopReason: options.stopReason,
    map:
      options.before.world === null
        ? null
        : {
            group: options.before.world.mapGroup,
            number: options.before.world.mapNum,
          },
    attemptsMade: options.attemptsMade,
    stepsTaken: options.stepsTaken,
    before: options.before,
    after: options.after,
  };
}

function findPathStep(options: {
  topology: EngineMapTopologyV1;
  readMapTile: ExitNavigationOptions["readMapTile"];
  start: Readonly<{ x: number; y: number }>;
  activations: readonly ExitActivation[];
  blockedTiles: ReadonlySet<string>;
  blockedEdges: ReadonlySet<string>;
}): ExitPathStep | null {
  const activationByPosition = new Map<string, ExitActivation>();
  for (const activation of options.activations) {
    activationByPosition.set(
      coordinateKey(activation.approach.x, activation.approach.y),
      activation,
    );
  }
  const startKey = coordinateKey(options.start.x, options.start.y);
  const currentActivation = activationByPosition.get(startKey);
  if (currentActivation !== undefined) {
    return { direction: null, activation: currentActivation };
  }
  const queue: { x: number; y: number }[] = [options.start];
  const firstStep = new Map<string, CardinalDirection>();
  const visited = new Set<string>([startKey]);
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (current === undefined) break;
    const currentKey = coordinateKey(current.x, current.y);
    for (const candidate of DIRECTIONS) {
      const next = {
        x: current.x + candidate.dx,
        y: current.y + candidate.dy,
      };
      if (!inBounds(options.topology, next)) continue;
      const key = coordinateKey(next.x, next.y);
      if (visited.has(key) || options.blockedTiles.has(key)) continue;
      if (options.blockedEdges.has(movementEdgeKey(current, next))) continue;
      if (options.readMapTile(next.x, next.y)?.passable !== true) continue;
      visited.add(key);
      const initial = firstStep.get(currentKey) ?? candidate.direction;
      firstStep.set(key, initial);
      const activation = activationByPosition.get(key);
      if (activation !== undefined) {
        return { direction: initial, activation };
      }
      queue.push(next);
    }
  }
  return null;
}

type PreparedExitNavigation =
  | Readonly<{ outcome: ExitNavigationOutcomeV1 }>
  | Readonly<{
      before: GameObservationV2;
      topology: EngineMapTopologyV1;
      activations: readonly ExitActivation[];
    }>;

function prepareExitNavigation(
  options: ExitNavigationOptions,
): PreparedExitNavigation {
  const before = options.observe();
  const topology = options.topology;
  if (topology === null) {
    return {
      outcome: exitResult({
        exitId: options.exitId,
        stopReason: "topology-unavailable",
        attemptsMade: 0,
        stepsTaken: 0,
        before,
        after: before,
      }),
    };
  }
  if (!mapMatchesTopology(before, topology)) {
    return {
      outcome: exitResult({
        exitId: options.exitId,
        stopReason: "topology-mismatch",
        attemptsMade: 0,
        stepsTaken: 0,
        before,
        after: before,
      }),
    };
  }
  const activations = exitActivations(topology, options.exitId);
  if (activations === null || activations.length === 0) {
    return {
      outcome: exitResult({
        exitId: options.exitId,
        stopReason:
          activations === null ? "exit-not-found" : "exit-not-navigable",
        attemptsMade: 0,
        stepsTaken: 0,
        before,
        after: before,
      }),
    };
  }
  return { before, topology, activations };
}

function currentNavigationStopReason(
  observation: GameObservationV2,
  topology: EngineMapTopologyV1,
): ExitNavigationStopReason | null {
  if (observation.phase !== "overworld") return "phase-changed";
  if (!mapMatchesTopology(observation, topology))
    return "unexpected-map-change";
  if (observation.world === null || !observation.readiness.inputReady) {
    return "field-input-not-ready";
  }
  return null;
}

function completedStepStopReason(
  observation: GameObservationV2,
  topology: EngineMapTopologyV1,
  settleTimedOut: boolean,
): ExitNavigationStopReason | null {
  if (settleTimedOut) return "settle-timeout";
  if (observation.phase !== "overworld") return "phase-changed";
  return mapMatchesTopology(observation, topology)
    ? null
    : "unexpected-map-change";
}

async function activateSelectedExit(options: {
  navigation: ExitNavigationOptions;
  path: ExitPathStep;
  before: GameObservationV2;
  topology: EngineMapTopologyV1;
  attemptsMade: number;
  stepsTaken: number;
}): Promise<ExitNavigationOutcomeV1> {
  const activation = await options.navigation.moveOne(
    options.path.activation.direction,
  );
  const after = activation.after;
  const mapChanged =
    after.world !== null && !mapMatchesTopology(after, options.topology);
  const reachedWarpLanding = reachedSelectedSameMapWarpLanding(
    options.topology,
    options.navigation.exitId,
    after,
  );
  const reachedWarpTrigger =
    options.path.activation.trigger !== null &&
    after.world !== null &&
    after.world.x === options.path.activation.trigger.x &&
    after.world.y === options.path.activation.trigger.y &&
    (options.path.activation.trigger.elevation === ELEVATION_TRANSITION ||
      after.world.elevation === options.path.activation.trigger.elevation);
  let stopReason: ExitNavigationStopReason = "activation-no-effect";
  if (mapChanged || reachedWarpLanding) {
    stopReason = "exit-traversed";
  } else if (after.phase !== "overworld" || reachedWarpTrigger) {
    stopReason = "exit-triggered";
  } else if (activation.stopReason === "settle-timeout") {
    stopReason = "settle-timeout";
  }
  return exitResult({
    exitId: options.navigation.exitId,
    stopReason,
    attemptsMade: options.attemptsMade + 1,
    stepsTaken: options.stepsTaken + activation.tilesMoved,
    before: options.before,
    after,
  });
}

export async function navigateGameExit(
  options: ExitNavigationOptions,
): Promise<ExitNavigationOutcomeV1> {
  const prepared = prepareExitNavigation(options);
  if ("outcome" in prepared) return prepared.outcome;
  const { before, topology, activations } = prepared;

  const blockedMovementEdges = new Set(
    competingAutomaticWarpEdges(topology, options.exitId),
  );
  let attemptsMade = 0;
  let stepsTaken = 0;
  let after = before;
  while (attemptsMade < options.maxSteps) {
    const current = options.observe();
    after = current;
    const currentStopReason = currentNavigationStopReason(current, topology);
    if (currentStopReason !== null || current.world === null) {
      return exitResult({
        exitId: options.exitId,
        stopReason: currentStopReason ?? "field-input-not-ready",
        attemptsMade,
        stepsTaken,
        before,
        after,
      });
    }
    const occupied = occupiedTiles(current);
    const path = findPathStep({
      topology,
      readMapTile: options.readMapTile,
      start: { x: current.world.x, y: current.world.y },
      activations,
      blockedTiles: occupied,
      blockedEdges: blockedMovementEdges,
    });
    if (path === null) {
      return exitResult({
        exitId: options.exitId,
        stopReason: "no-route",
        attemptsMade,
        stepsTaken,
        before,
        after,
      });
    }

    if (path.direction === null) {
      return activateSelectedExit({
        navigation: options,
        path,
        before,
        topology,
        attemptsMade,
        stepsTaken,
      });
    }

    const intended = nextCoordinate(
      current.world.x,
      current.world.y,
      path.direction,
    );
    attemptsMade += 1;
    const step = await options.moveOne(path.direction);
    after = step.after;
    const completedStopReason = completedStepStopReason(
      after,
      topology,
      step.stopReason === "settle-timeout",
    );
    if (completedStopReason !== null) {
      return exitResult({
        exitId: options.exitId,
        stopReason: completedStopReason,
        attemptsMade,
        stepsTaken,
        before,
        after,
      });
    }
    if (step.tilesMoved === 0) {
      blockedMovementEdges.add(
        movementEdgeKey({ x: current.world.x, y: current.world.y }, intended),
      );
      continue;
    }
    stepsTaken += step.tilesMoved;
  }
  return exitResult({
    exitId: options.exitId,
    stopReason: "max-steps",
    attemptsMade,
    stepsTaken,
    before,
    after,
  });
}
