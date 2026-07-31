import type { Emulator } from "#src/emulator/emulator.ts";
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
