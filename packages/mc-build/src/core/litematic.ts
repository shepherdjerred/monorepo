import nbt from "prismarine-nbt";
import { z } from "zod";
import { blockId, formatBlockState, isAir } from "./block-state.ts";
import { BlockGrid, type GridBlockEntity, type Vec3 } from "./grid.ts";

/**
 * Litematica schematics (`.litematic`): gzipped NBT with one or more named
 * regions. Each region has a `Position` and a signed `Size` relative to the
 * schematic origin (a negative size extends toward smaller coordinates), a
 * `BlockStatePalette` of `{Name, Properties}`, and `BlockStates`, a long array
 * of palette indices packed back to back across long boundaries (no padding)
 * at `max(2, ceil(log2(paletteSize)))` bits each, in YZX order. Matches
 * Litematica's LitematicaBitArray and LitematicaSchematic.readBlocksFromNBT.
 */

const PosSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
});
/** prismarine-nbt longs are `[high, low]` signed int32 pairs. */
const LongSchema = z.tuple([z.number().int(), z.number().int()]);

const RegionSchema = z.object({
  Position: PosSchema,
  Size: PosSchema,
  BlockStatePalette: z
    .array(
      z.object({
        Name: z.string().min(1),
        Properties: z.record(z.string(), z.string()).optional(),
      }),
    )
    .min(1),
  BlockStates: z.array(LongSchema),
  TileEntities: z
    .array(
      z.object({
        x: z.number().int(),
        y: z.number().int(),
        z: z.number().int(),
      }),
    )
    .optional(),
});

const LitematicSchema = z.object({
  Version: z.number().int(),
  MinecraftDataVersion: z.number().int().optional(),
  Metadata: z
    .object({
      Name: z.string().optional(),
      Author: z.string().optional(),
    })
    .optional(),
  Regions: z.record(z.string(), RegionSchema),
});

export type LitematicRegion = {
  name: string;
  /** Min corner relative to the merged grid's (0,0,0). */
  min: Vec3;
  size: Vec3;
};

export type LitematicInfo = {
  grid: BlockGrid;
  /** Data version the file was saved with, when it records one. */
  dataVersion: number | null;
  name: string;
  author: string;
  regions: LitematicRegion[];
};

/** Bits per palette index, as Litematica computes them. */
export function litematicBits(paletteSize: number): number {
  return Math.max(2, 32 - Math.clz32(paletteSize - 1));
}

function toUnsigned64([high, low]: readonly [number, number]): bigint {
  return BigInt.asUintN(64, (BigInt(high) << 32n) | BigInt(low >>> 0));
}

/** Decodes `volume` packed indices of `bits` each (LitematicaBitArray.getAt). */
export function unpackLitematicIndices(
  longs: readonly bigint[],
  bits: number,
  volume: number,
): Uint32Array {
  const needed = Math.ceil((volume * bits) / 64);
  if (longs.length < needed) {
    throw new Error(
      `Litematic region needs ${needed.toString()} longs for ${volume.toString()} blocks at ${bits.toString()} bits, has ${longs.length.toString()}`,
    );
  }
  const mask = (1n << BigInt(bits)) - 1n;
  const out = new Uint32Array(volume);
  for (let index = 0; index < volume; index += 1) {
    const start = index * bits;
    const startLong = start >> 6;
    const endLong = ((index + 1) * bits - 1) >> 6;
    const offset = BigInt(start & 63);
    const low = longs[startLong] ?? 0n;
    let value = low >> offset;
    if (startLong !== endLong) {
      const high = longs[endLong] ?? 0n;
      value |= high << (64n - offset);
    }
    out[index] = Number(value & mask);
  }
  return out;
}

/** Litematica's getRelativeEndPositionFromAreaSize on one axis. */
function relativeEnd(size: number): number {
  return size > 0 ? size - 1 : size + 1;
}

function regionMin(position: Vec3, size: Vec3): Vec3 {
  return {
    x: Math.min(position.x, position.x + relativeEnd(size.x)),
    y: Math.min(position.y, position.y + relativeEnd(size.y)),
    z: Math.min(position.z, position.z + relativeEnd(size.z)),
  };
}

type Region = z.infer<typeof RegionSchema>;
type Placed = { name: string; region: Region; size: Vec3; min: Vec3 };

function place(name: string, region: Region): Placed {
  const size = {
    x: Math.abs(region.Size.x),
    y: Math.abs(region.Size.y),
    z: Math.abs(region.Size.z),
  };
  if (size.x === 0 || size.y === 0 || size.z === 0) {
    throw new Error(`Litematic region "${name}" has an empty size`);
  }
  return { name, region, size, min: regionMin(region.Position, region.Size) };
}

function enclosing(regions: readonly Placed[]): { origin: Vec3; extent: Vec3 } {
  const origin = { x: Infinity, y: Infinity, z: Infinity };
  const end = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const { min, size } of regions) {
    origin.x = Math.min(origin.x, min.x);
    origin.y = Math.min(origin.y, min.y);
    origin.z = Math.min(origin.z, min.z);
    end.x = Math.max(end.x, min.x + size.x);
    end.y = Math.max(end.y, min.y + size.y);
    end.z = Math.max(end.z, min.z + size.z);
  }
  return {
    origin,
    extent: { x: end.x - origin.x, y: end.y - origin.y, z: end.z - origin.z },
  };
}

function regionPalette(region: Region): string[] {
  return region.BlockStatePalette.map((entry) =>
    formatBlockState({
      id: entry.Name.includes(":") ? entry.Name : `minecraft:${entry.Name}`,
      properties: entry.Properties ?? {},
    }),
  );
}

/** Copies one region's non-air blocks into the merged grid at `offset`. */
function paint(grid: BlockGrid, placed: Placed, offset: Vec3): void {
  const { name, region, size } = placed;
  const palette = regionPalette(region);
  const indices = unpackLitematicIndices(
    region.BlockStates.map((long) => toUnsigned64(long)),
    litematicBits(palette.length),
    size.x * size.y * size.z,
  );
  indices.forEach((paletteIndex, index) => {
    const state = palette[paletteIndex];
    if (state === undefined) {
      throw new Error(
        `Litematic region "${name}" references palette index ${paletteIndex.toString()} of ${palette.length.toString()}`,
      );
    }
    if (isAir(state)) {
      return;
    }
    const x = index % size.x;
    const rest = (index - x) / size.x;
    const cz = rest % size.z;
    grid.set(
      x + offset.x,
      (rest - cz) / size.z + offset.y,
      cz + offset.z,
      state,
    );
  });
}

export async function readLitematic(bytes: Uint8Array): Promise<LitematicInfo> {
  const { parsed } = await nbt.parse(Buffer.from(bytes));
  const file = LitematicSchema.parse(nbt.simplify(parsed));
  const regions = Object.entries(file.Regions).map(([name, region]) =>
    place(name, region),
  );
  if (regions.length === 0) {
    throw new Error("Litematic has no regions");
  }
  const { origin, extent } = enclosing(regions);
  const grid = new BlockGrid(extent);
  const blockEntities: GridBlockEntity[] = [];
  const merged: LitematicRegion[] = [];
  for (const placed of regions) {
    const offset = {
      x: placed.min.x - origin.x,
      y: placed.min.y - origin.y,
      z: placed.min.z - origin.z,
    };
    paint(grid, placed, offset);
    for (const entity of placed.region.TileEntities ?? []) {
      const pos = {
        x: entity.x + offset.x,
        y: entity.y + offset.y,
        z: entity.z + offset.z,
      };
      // Like the bridge contract: the id of the block holding the entity.
      blockEntities.push({ pos, id: blockId(grid.get(pos.x, pos.y, pos.z)) });
    }
    merged.push({ name: placed.name, min: offset, size: placed.size });
  }
  grid.blockEntities = blockEntities;
  return {
    grid,
    dataVersion: file.MinecraftDataVersion ?? null,
    name: file.Metadata?.Name ?? "",
    author: file.Metadata?.Author ?? "",
    regions: merged,
  };
}
