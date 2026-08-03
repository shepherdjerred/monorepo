import type { Emulator } from "#src/emulator/emulator.ts";
import type { CardinalDirection } from "#src/emulator/engine-observation.ts";
import type {
  EngineMapConnectionDirection,
  EngineMapTopologyV1,
} from "#src/emulator/engine-map-topology.ts";
import { mapName } from "#src/game/spatial/generated/map-names.ts";
import { readMapObjects } from "#src/game/spatial/spatial-snapshot.ts";
import { readGameObservation } from "./game-observation.ts";

export type GameMapViewV1 = Readonly<{
  schemaVersion: 1;
  map: Readonly<{
    name: string;
    group: number;
    number: number;
  }>;
  center: Readonly<{ x: number; y: number }>;
  radius: number;
  bounds: Readonly<{ minX: number; maxX: number; minY: number; maxY: number }>;
  rows: readonly Readonly<{ y: number; cells: string }>[];
  legend: Readonly<Record<string, string>>;
}>;

type GameMapDestination = Readonly<{
  name: string;
  group: number;
  number: number;
}>;

export type GameMapConnectionExit = Readonly<{
  id: string;
  kind: "connection";
  direction: EngineMapConnectionDirection;
  destination: GameMapDestination;
  edge: Readonly<{
    from: Readonly<{ x: number; y: number }>;
    to: Readonly<{ x: number; y: number }>;
  }> | null;
  traversableByNavigate: boolean;
}>;

export type GameMapWarpExit = Readonly<{
  id: string;
  kind: "warp";
  trigger: Readonly<{
    x: number;
    y: number;
    elevation: number;
    behavior: number;
  }>;
  requiredDirection: CardinalDirection | null;
  destination: Readonly<
    GameMapDestination & {
      warpId: number;
      landing: Readonly<{ x: number; y: number }> | null;
    }
  > | null;
  dynamicDestination: boolean;
  traversableByNavigate: boolean;
}>;

export type GameMapExit = GameMapConnectionExit | GameMapWarpExit;

export type GameMapExitsV1 = Readonly<{
  schemaVersion: 1;
  map: Readonly<
    GameMapDestination & {
      bounds: Readonly<{
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
      }>;
    }
  >;
  exits: readonly GameMapExit[];
}>;

function objectMarker(kind: "npc" | "item" | "tree" | "rock"): string {
  switch (kind) {
    case "npc":
      return "N";
    case "item":
      return "I";
    case "tree":
      return "T";
    case "rock":
      return "R";
  }
}

export function readGameMap(emulator: Emulator, radius: number): GameMapViewV1 {
  if (!Number.isInteger(radius) || radius < 1 || radius > 20) {
    throw new RangeError("map radius must be an integer from 1 through 20");
  }
  const observation = readGameObservation(emulator);
  const world = observation.world;
  if (world === null) {
    throw new Error("current map is unavailable");
  }
  const minX = world.x - radius;
  const maxX = world.x + radius;
  const minY = world.y - radius;
  const maxY = world.y + radius;
  const objects = new Map<string, string>();
  const activeObjects = readMapObjects(
    emulator.memoryReader(),
    emulator.gameSymbols(),
  );
  if (activeObjects === null) {
    throw new Error("current map objects are unavailable");
  }
  for (const object of activeObjects) {
    objects.set(
      `${String(object.x)},${String(object.y)}`,
      objectMarker(object.kind),
    );
  }

  const rows: { y: number; cells: string }[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    let cells = "";
    for (let x = minX; x <= maxX; x += 1) {
      if (x === world.x && y === world.y) {
        cells += "P";
        continue;
      }
      const marker = objects.get(`${String(x)},${String(y)}`);
      if (marker !== undefined) {
        cells += marker;
        continue;
      }
      const tile = emulator.engineMapTile(x, y);
      cells += tile === null ? "?" : tile.passable ? "." : "#";
    }
    rows.push({ y, cells });
  }

  return {
    schemaVersion: 1,
    map: {
      name: world.map,
      group: world.mapGroup,
      number: world.mapNum,
    },
    center: { x: world.x, y: world.y },
    radius,
    bounds: { minX, maxX, minY, maxY },
    rows,
    legend: {
      P: "player",
      ".": "engine-passable tile",
      "#": "engine-colliding tile",
      N: "active NPC",
      I: "active item",
      T: "cuttable tree",
      R: "breakable rock",
      "?": "unavailable tile",
    },
  };
}

export function gameMapExits(topology: EngineMapTopologyV1): GameMapExitsV1 {
  const exits: GameMapExit[] = [];
  for (const connection of topology.connections) {
    exits.push({
      id: `connection:${String(connection.index)}`,
      kind: "connection",
      direction: connection.direction,
      destination: {
        name: mapName(
          connection.destination.mapGroup,
          connection.destination.mapNum,
        ),
        group: connection.destination.mapGroup,
        number: connection.destination.mapNum,
      },
      edge:
        connection.span === null
          ? null
          : {
              from: connection.span.start,
              to: connection.span.end,
            },
      traversableByNavigate:
        connection.span !== null &&
        connection.direction !== "dive" &&
        connection.direction !== "emerge",
    });
  }
  for (const warp of topology.warps) {
    exits.push({
      id: `warp:${String(warp.index)}`,
      kind: "warp",
      trigger: warp.trigger,
      requiredDirection:
        warp.activation === "step" || warp.activation === "unsupported"
          ? null
          : warp.activation,
      destination: warp.destination.dynamic
        ? null
        : {
            name: mapName(warp.destination.mapGroup, warp.destination.mapNum),
            group: warp.destination.mapGroup,
            number: warp.destination.mapNum,
            warpId: warp.destination.warpId,
            landing: warp.destination.landing,
          },
      dynamicDestination: warp.destination.dynamic,
      traversableByNavigate: warp.activation !== "unsupported",
    });
  }
  return {
    schemaVersion: 1,
    map: {
      name: mapName(topology.mapGroup, topology.mapNum),
      group: topology.mapGroup,
      number: topology.mapNum,
      bounds: topology.bounds,
    },
    exits,
  };
}

export function readGameMapExits(emulator: Emulator): GameMapExitsV1 {
  const topology = emulator.engineMapTopology();
  if (topology === null) {
    throw new Error("current map topology is unavailable");
  }
  return gameMapExits(topology);
}
