import type { EngineMapTopologyV1 } from "#src/emulator/engine-map-topology.ts";
import type { GameObservationV2 } from "./game-observation.ts";

export function coordinateKey(x: number, y: number): string {
  return `${String(x)},${String(y)}`;
}

export function competingAutomaticWarpTriggers(
  topology: EngineMapTopologyV1,
  exitId: string,
): ReadonlySet<string> {
  return new Set(
    topology.warps
      .filter(
        (warp) =>
          warp.activation === "step" && exitId !== `warp:${String(warp.index)}`,
      )
      .map((warp) => coordinateKey(warp.trigger.x, warp.trigger.y)),
  );
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
