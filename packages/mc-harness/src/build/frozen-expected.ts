import { isDeepStrictEqual } from "node:util";
import { gridFromRegionRead } from "@shepherdjerred/mc-build/core/grid.ts";
import { blockId } from "@shepherdjerred/mc-build/core/block-state.ts";
import { readSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import type { BlockPos, Box, RegionReadResponse } from "#protocol/bridge.ts";
import { boxSize } from "./tiles.ts";
/** A frozen snapshot tile and its paste location. */
export type FrozenPart = { at: BlockPos; bytes: Uint8Array };

/** The judged JSON and pasteable frozen run must cover the same exact blocks. */
export async function validateFrozenExpected(
  box: Box,
  region: RegionReadResponse,
  parts: readonly FrozenPart[],
) {
  if (
    region.world !== box.world ||
    !isDeepStrictEqual(region.min, box.min) ||
    !isDeepStrictEqual(region.max, box.max) ||
    !isDeepStrictEqual(region.size, boxSize(box))
  ) {
    throw new Error(
      "expected result does not match the captured world box; run the build again",
    );
  }
  const grid = gridFromRegionRead(region);
  const seen = new Uint8Array(grid.volume);
  const entities = new Map<number, string>();
  for (const entity of grid.blockEntities) {
    const { x, y, z } = entity.pos;
    const index = grid.index(x, y, z);
    if (
      !grid.inBounds(x, y, z) ||
      entities.has(index) ||
      entity.id !== blockId(grid.get(x, y, z))
    )
      throw new Error("expected JSON has invalid block-entity evidence");
    entities.set(index, entity.id);
  }
  let covered = 0;
  for (const part of parts) {
    const schematic = await readSchematic(part.bytes);
    schematic.grid.forEach((x, y, z, state) => {
      const cx = x + part.at.x - box.min.x;
      const cy = y + part.at.y - box.min.y;
      const cz = z + part.at.z - box.min.z;
      const index = grid.index(cx, cy, cz);
      if (!grid.inBounds(cx, cy, cz) || seen[index] !== 0) {
        throw new Error(
          "frozen expected tiles overlap or exceed the captured box",
        );
      }
      if (grid.get(cx, cy, cz) !== state) {
        throw new Error(
          "expected JSON does not match the frozen run; run the build again",
        );
      }
      seen[index] = 1;
      covered += 1;
    });
    for (const entity of schematic.grid.blockEntities) {
      const { x, y, z } = entity.pos;
      const cx = x + part.at.x - box.min.x;
      const cy = y + part.at.y - box.min.y;
      const cz = z + part.at.z - box.min.z;
      const index = grid.index(cx, cy, cz);
      // RegionReader exposes the holder id, while Sponge stores the NBT type.
      // Compare the shared identity: one entity at this position and holder.
      if (
        !schematic.grid.inBounds(x, y, z) ||
        entities.get(index) !== blockId(schematic.grid.get(x, y, z))
      )
        throw new Error("expected JSON does not match frozen block entities");
      entities.delete(index);
    }
  }
  if (covered !== grid.volume)
    throw new Error("frozen expected tiles do not cover the captured box");
  if (entities.size > 0)
    throw new Error("expected JSON does not match frozen block entities");
  return grid;
}
