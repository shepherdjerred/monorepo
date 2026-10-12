import { readSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import type { BlockPos, Box } from "#protocol/bridge.ts";
import { boxOf } from "#src/box.ts";

type Rotation = 0 | 90 | 180 | 270;

export type PastePlacement = { world: string; at: BlockPos; rotate: Rotation };

/**
 * `//rotate 90` (and the bridge's paste rotation) turns east-facing blocks
 * south-facing: clockwise seen from above, so (x, z) -> (-z, x) around the
 * paste origin.
 */
export function rotateXZ(
  x: number,
  z: number,
  rotate: Rotation,
): [number, number] {
  switch (rotate) {
    case 0: {
      return [x, z];
    }
    case 90: {
      return [-z, x];
    }
    case 180: {
      return [-x, -z];
    }
    case 270: {
      return [z, -x];
    }
  }
}

/**
 * The world box a paste changes: the schematic's extent (its offset is the
 * min corner relative to the origin) rotated around the origin, placed at `at`.
 */
export function pasteBoxFor(
  placement: PastePlacement,
  size: BlockPos,
  offset: BlockPos,
): Box {
  const { world, at, rotate } = placement;
  const corners: [number, number][] = [];
  for (const x of [offset.x, offset.x + size.x - 1]) {
    for (const z of [offset.z, offset.z + size.z - 1]) {
      corners.push(rotateXZ(x, z, rotate));
    }
  }
  const xs = corners.map(([x]) => x);
  const zs = corners.map(([, z]) => z);
  return boxOf(
    world,
    {
      x: at.x + Math.min(...xs),
      y: at.y + offset.y,
      z: at.z + Math.min(...zs),
    },
    {
      x: at.x + Math.max(...xs),
      y: at.y + offset.y + size.y - 1,
      z: at.z + Math.max(...zs),
    },
  );
}

/** Decodes the pasted schematic (base64 `.schem`) to compute its world box. */
export async function pasteBox(
  world: string,
  at: BlockPos,
  rotate: Rotation,
  schematicBase64: string,
): Promise<Box> {
  const info = await readSchematic(
    new Uint8Array(Buffer.from(schematicBase64, "base64")),
  );
  return pasteBoxFor({ world, at, rotate }, info.grid.size, info.offset);
}
