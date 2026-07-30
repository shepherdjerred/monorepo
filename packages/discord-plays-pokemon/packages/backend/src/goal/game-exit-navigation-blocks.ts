import type { CardinalDirection } from "#src/emulator/engine-observation.ts";
import type { EngineMapTopologyV1 } from "#src/emulator/engine-map-topology.ts";
import type { GameObservationV2 } from "./game-observation.ts";

const DIRECTION_OFFSETS: readonly Readonly<{
  direction: CardinalDirection;
  dx: number;
  dy: number;
}>[] = [
  { direction: "north", dx: 0, dy: -1 },
  { direction: "south", dx: 0, dy: 1 },
  { direction: "west", dx: -1, dy: 0 },
  { direction: "east", dx: 1, dy: 0 },
];

export function coordinateKey(x: number, y: number): string {
  return `${String(x)},${String(y)}`;
}

export function movementEdgeKey(
  from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>,
): string {
  return `${coordinateKey(from.x, from.y)}>${coordinateKey(to.x, to.y)}`;
}

export function mapMatchesTopology(
  observation: GameObservationV2,
  topology: EngineMapTopologyV1,
): boolean {
  return (
    observation.world !== null &&
    observation.world.mapGroup === topology.mapGroup &&
    observation.world.mapNum === topology.mapNum
  );
}

export function reachedSelectedSameMapWarpLanding(
  topology: EngineMapTopologyV1,
  exitId: string,
  observation: GameObservationV2,
): boolean {
  const warp = topology.warps.find(
    (candidate) => exitId === `warp:${String(candidate.index)}`,
  );
  const world = observation.world;
  if (warp === undefined || world === null) return false;
  const landing = warp.destination.landing;
  if (landing === null) return false;
  return (
    warp.destination.mapGroup === topology.mapGroup &&
    warp.destination.mapNum === topology.mapNum &&
    mapMatchesTopology(observation, topology) &&
    (landing.x !== warp.trigger.x || landing.y !== warp.trigger.y) &&
    world.x === landing.x &&
    world.y === landing.y
  );
}

export function competingAutomaticWarpEdges(
  topology: EngineMapTopologyV1,
  exitId: string,
): ReadonlySet<string> {
  const edges = new Set<string>();
  for (const warp of topology.warps) {
    if (
      warp.activation === "unsupported" ||
      exitId === `warp:${String(warp.index)}`
    ) {
      continue;
    }
    const triggeringDirections =
      warp.activation === "step"
        ? DIRECTION_OFFSETS
        : DIRECTION_OFFSETS.filter(
            (candidate) => candidate.direction === warp.activation,
          );
    if (triggeringDirections.length === 0) {
      throw new RangeError(
        `unknown directional warp activation: ${warp.activation}`,
      );
    }
    for (const direction of triggeringDirections) {
      edges.add(
        movementEdgeKey(
          {
            x: warp.trigger.x - direction.dx,
            y: warp.trigger.y - direction.dy,
          },
          warp.trigger,
        ),
      );
    }
  }
  return edges;
}

export function occupiedTiles(
  observation: GameObservationV2,
): ReadonlySet<string> {
  const occupied = new Set<string>();
  const world = observation.world;
  if (world === null) return occupied;
  for (const object of world.nearby) {
    occupied.add(coordinateKey(world.x + object.dx, world.y + object.dy));
  }
  return occupied;
}
