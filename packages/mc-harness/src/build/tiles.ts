/**
 * Map-scale builds exceed the bridge's per-request volume (BRIDGE_LIMITS), so
 * reads, snapshots and pastes over a large box are split into full-height
 * column tiles and merged back here.
 */
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import {
  BRIDGE_LIMITS,
  type BlockPos,
  type Box,
  type RegionReadResponse,
} from "#protocol/bridge.ts";

/** Headroom under the bridge limits so a tile is never rejected. */
export const TILE_VOLUME = Math.floor(
  Math.min(BRIDGE_LIMITS.maxReadVolume, BRIDGE_LIMITS.maxSnapshotVolume) * 0.9,
);

/**
 * Widest tile side: a box spanning N blocks touches at most ceil(N/16)+1
 * chunks per axis, and the bridge reads at most 4,096 chunk columns (64×64),
 * so 62 chunks of 16 keeps any alignment within the limit.
 */
export const MAX_TILE_SIDE = 62 * 16;

export function boxSize(box: Pick<Box, "min" | "max">): BlockPos {
  return {
    x: box.max.x - box.min.x + 1,
    y: box.max.y - box.min.y + 1,
    z: box.max.z - box.min.z + 1,
  };
}

export function boxVolume(box: Pick<Box, "min" | "max">): number {
  const size = boxSize(box);
  return size.x * size.y * size.z;
}

/**
 * Splits `box` into full-height column tiles of at most `maxVolume` cells,
 * in x-then-z order. A box within the limit is returned unchanged.
 */
export function tileBox(box: Box, maxVolume = TILE_VOLUME): Box[] {
  const size = boxSize(box);
  if (
    size.x * size.y * size.z <= maxVolume &&
    Math.max(size.x, size.z) <= MAX_TILE_SIDE
  ) {
    return [box];
  }
  // Also stay within the bridge's chunk-column limit for short, wide boxes.
  const side = Math.min(
    Math.floor(Math.sqrt(maxVolume / size.y)),
    MAX_TILE_SIDE,
  );
  if (side < 1) {
    throw new Error(
      `A ${size.y.toString()}-block-tall column exceeds the ${maxVolume.toString()}-cell tile volume`,
    );
  }
  const tiles: Box[] = [];
  for (let z = box.min.z; z <= box.max.z; z += side) {
    for (let x = box.min.x; x <= box.max.x; x += side) {
      tiles.push({
        world: box.world,
        min: { x, y: box.min.y, z },
        max: {
          x: Math.min(x + side - 1, box.max.x),
          y: box.max.y,
          z: Math.min(z + side - 1, box.max.z),
        },
      });
    }
  }
  return tiles;
}

/** Joins tile region reads (each covering part of `box`) into one read of `box`. */
export function mergeRegionReads(
  box: Box,
  parts: readonly RegionReadResponse[],
): RegionReadResponse {
  const size = boxSize(box);
  const palette: string[] = [];
  const lookup = new Map<string, number>();
  const indexOf = (state: string): number => {
    const known = lookup.get(state);
    if (known !== undefined) {
      return known;
    }
    lookup.set(state, palette.length);
    palette.push(state);
    return palette.length - 1;
  };
  const out = Buffer.alloc(size.x * size.y * size.z * 4);
  let covered = 0;
  for (const part of parts) {
    const remap = part.palette.map((state) => indexOf(state));
    const bytes = Buffer.from(part.blocks, "base64");
    const dx = part.min.x - box.min.x;
    const dy = part.min.y - box.min.y;
    const dz = part.min.z - box.min.z;
    for (let y = 0; y < part.size.y; y += 1) {
      for (let z = 0; z < part.size.z; z += 1) {
        for (let x = 0; x < part.size.x; x += 1) {
          const from = ((y * part.size.z + z) * part.size.x + x) * 4;
          const to = (((y + dy) * size.z + (z + dz)) * size.x + (x + dx)) * 4;
          out.writeUInt32LE(remap[bytes.readUInt32LE(from)] ?? 0, to);
        }
      }
    }
    covered += part.size.x * part.size.y * part.size.z;
  }
  if (covered !== size.x * size.y * size.z) {
    throw new Error(
      `Region tiles cover ${covered.toString()} cells; the box has ${(size.x * size.y * size.z).toString()}`,
    );
  }
  return {
    world: box.world,
    min: box.min,
    max: box.max,
    size,
    palette,
    blocks: out.toString("base64"),
    blockEntities: parts.flatMap((part) => part.blockEntities),
  };
}

/** Composite snapshot ids join tile snapshot ids (which never contain commas). */
export function joinSnapshotIds(ids: readonly string[]): string {
  return ids.join(",");
}

export function splitSnapshotIds(id: string): string[] {
  return id.split(",");
}

/** Copies `source` into `target` with its min corner at `offset`. */
export function placeGrid(
  target: BlockGrid,
  source: BlockGrid,
  offset: BlockPos,
): void {
  for (let y = 0; y < source.size.y; y += 1) {
    for (let z = 0; z < source.size.z; z += 1) {
      for (let x = 0; x < source.size.x; x += 1) {
        target.set(
          x + offset.x,
          y + offset.y,
          z + offset.z,
          source.get(x, y, z),
        );
      }
    }
  }
}

export function emptyGrid(size: BlockPos): BlockGrid {
  return new BlockGrid(size);
}

/** The `size` cells of `grid` starting at `min` (grid-local), as a new grid. */
export function cropGrid(
  grid: BlockGrid,
  min: BlockPos,
  size: BlockPos,
): BlockGrid {
  const out = new BlockGrid(size);
  for (let y = 0; y < size.y; y += 1) {
    for (let z = 0; z < size.z; z += 1) {
      for (let x = 0; x < size.x; x += 1) {
        out.set(x, y, z, grid.get(x + min.x, y + min.y, z + min.z));
      }
    }
  }
  return out;
}
