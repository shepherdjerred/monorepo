import nbt from "prismarine-nbt";
import { z } from "zod";
import { BlockGrid, type GridBlockEntity, type Vec3 } from "./grid.ts";

/**
 * Sponge schematic v3 (`.schem`), the format WorldEdit 7.4 reads and writes
 * and the bridge's snapshots use. Block data is varint palette indices in YZX
 * order; `Offset` is the min corner relative to the paste origin. Grids we
 * write use Offset [0,0,0], so `//paste`/`/v1/we/paste` at `at` puts grid
 * cell (0,0,0) at `at`.
 */

const SchematicSchema = z.object({
  Version: z.literal(3),
  DataVersion: z.number().int(),
  Width: z.number().int(),
  Height: z.number().int(),
  Length: z.number().int(),
  Offset: z.array(z.number().int()).length(3).optional(),
  Blocks: z.object({
    Palette: z.record(z.string(), z.number().int()),
    Data: z.array(z.number().int()),
    BlockEntities: z
      .array(
        z.object({
          Id: z.string(),
          Pos: z.array(z.number().int()).length(3),
        }),
      )
      .optional(),
  }),
});

export type SchematicInfo = {
  grid: BlockGrid;
  dataVersion: number;
  /** Min corner relative to the paste origin. */
  offset: Vec3;
};

function readVarints(bytes: readonly number[], expected: number): Uint32Array {
  const out = new Uint32Array(expected);
  let cursor = 0;
  for (let index = 0; index < expected; index += 1) {
    let value = 0;
    let shift = 0;
    for (;;) {
      const raw = bytes[cursor];
      if (raw === undefined) {
        throw new Error(
          `Schematic block data ended after ${index.toString()} of ${expected.toString()} blocks`,
        );
      }
      cursor += 1;
      const byte = raw & 0xff;
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        break;
      }
      shift += 7;
      if (shift > 28) {
        throw new Error("Schematic varint is too long");
      }
    }
    out[index] = value >>> 0;
  }
  if (cursor !== bytes.length) {
    throw new Error(
      `Schematic block data has ${(bytes.length - cursor).toString()} trailing bytes`,
    );
  }
  return out;
}

function writeVarints(values: Uint32Array): number[] {
  const out: number[] = [];
  for (const value of values) {
    let remaining = value;
    while (remaining >= 0x80) {
      out.push((remaining & 0x7f) | 0x80);
      remaining >>>= 7;
    }
    out.push(remaining);
  }
  // NBT byte arrays are signed.
  return out.map((byte) => (byte > 127 ? byte - 256 : byte));
}

const SchematicSizeSchema = z.object({
  Width: z.number().int(),
  Height: z.number().int(),
  Length: z.number().int(),
});

/** A schematic's dimensions, without decoding its blocks. */
export async function schematicSize(bytes: Uint8Array): Promise<Vec3> {
  const { parsed } = await nbt.parse(Buffer.from(bytes));
  const root: unknown = nbt.simplify(parsed);
  const container = z.object({ Schematic: z.unknown() }).safeParse(root);
  const dims = SchematicSizeSchema.parse(
    container.success ? container.data.Schematic : root,
  );
  return { x: dims.Width, y: dims.Height, z: dims.Length };
}

export async function readSchematic(bytes: Uint8Array): Promise<SchematicInfo> {
  const { parsed } = await nbt.parse(Buffer.from(bytes));
  const root: unknown = nbt.simplify(parsed);
  const container = z.object({ Schematic: z.unknown() }).safeParse(root);
  const schematic = SchematicSchema.parse(
    container.success ? container.data.Schematic : root,
  );
  const size = {
    x: schematic.Width,
    y: schematic.Height,
    z: schematic.Length,
  };
  const palette: string[] = [];
  for (const [state, index] of Object.entries(schematic.Blocks.Palette)) {
    palette[index] = state;
  }
  if (palette.some((entry) => typeof entry !== "string")) {
    throw new Error("Schematic palette indices are not contiguous");
  }
  const indices = readVarints(schematic.Blocks.Data, size.x * size.y * size.z);
  const grid = BlockGrid.fromIndices(size, palette, indices);
  grid.blockEntities = (schematic.Blocks.BlockEntities ?? []).map(
    (entity): GridBlockEntity => ({
      id: entity.Id,
      pos: {
        x: entity.Pos[0] ?? 0,
        y: entity.Pos[1] ?? 0,
        z: entity.Pos[2] ?? 0,
      },
    }),
  );
  const [ox = 0, oy = 0, oz = 0] = schematic.Offset ?? [0, 0, 0];
  return {
    grid,
    dataVersion: schematic.DataVersion,
    offset: { x: ox, y: oy, z: oz },
  };
}

/**
 * Writes a gzipped Sponge v3 schematic. Block entities are not written: grids
 * built by the DSL carry none, and the game creates empty ones (e.g. chests)
 * when the block is placed.
 */
export function writeSchematic(
  source: BlockGrid,
  dataVersion: number,
  /** Min corner relative to the paste origin (WorldEdit `Offset`); default 0,0,0. */
  offset?: Vec3,
): Uint8Array {
  const grid = source.compacted();
  const { x: ox, y: oy, z: oz } = offset ?? { x: 0, y: 0, z: 0 };
  const palette: Record<string, nbt.Int> = {};
  grid.palette.forEach((state, index) => {
    palette[state] = { type: "int", value: index };
  });
  const root: nbt.NBT = {
    type: "compound",
    name: "",
    value: {
      Schematic: {
        type: "compound",
        value: {
          Version: { type: "int", value: 3 },
          DataVersion: { type: "int", value: dataVersion },
          Width: { type: "short", value: grid.size.x },
          Height: { type: "short", value: grid.size.y },
          Length: { type: "short", value: grid.size.z },
          Offset: { type: "intArray", value: [ox, oy, oz] },
          Blocks: {
            type: "compound",
            value: {
              Palette: { type: "compound", value: palette },
              Data: { type: "byteArray", value: writeVarints(grid.data) },
            },
          },
        },
      },
    },
  };
  const uncompressed = nbt.writeUncompressed(root, "big");
  return Bun.gzipSync(new Uint8Array(uncompressed));
}
