// Before/after spatial position for press/chord tool responses. Lets the model
// (and goal.tool logs) see whether a move actually changed tiles — the #1 gap
// behind "I pressed north and nothing happened" thrash.

import { mapName } from "#src/game/spatial/generated/map-names.ts";
import type {
  Facing,
  SpatialSnapshot,
} from "#src/game/spatial/spatial-snapshot.ts";

export type SpatialPosition = {
  map: string;
  x: number;
  y: number;
  facing: Facing;
  mode: string;
};

export type MovementOutcome = {
  before: SpatialPosition | null;
  after: SpatialPosition | null;
  moved: boolean;
  // True when x/y/map did not change. For direction presses this is turn-only
  // or wall collision; for A/B/etc it just means position was unchanged.
  blocked: boolean;
};

export function spatialPositionFromSnapshot(
  spatial: SpatialSnapshot | null,
): SpatialPosition | null {
  if (spatial === null) {
    return null;
  }
  return {
    map: mapName(spatial.mapGroup, spatial.mapNum),
    x: spatial.x,
    y: spatial.y,
    facing: spatial.facing,
    mode: spatial.movementMode,
  };
}

export function movementOutcome(
  before: SpatialPosition | null,
  after: SpatialPosition | null,
): MovementOutcome {
  if (before === null || after === null) {
    return { before, after, moved: false, blocked: false };
  }
  const moved =
    before.x !== after.x || before.y !== after.y || before.map !== after.map;
  return { before, after, moved, blocked: !moved };
}
