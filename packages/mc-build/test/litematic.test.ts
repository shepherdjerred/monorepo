import nbt from "prismarine-nbt";
import { describe, expect, test } from "vitest";
import {
  litematicBits,
  readLitematic,
  unpackLitematicIndices,
} from "#src/core/litematic.ts";

/** Packs indices exactly like LitematicaBitArray.setAt, as prismarine-nbt longs. */
function pack(indices: readonly number[], bits: number): [number, number][] {
  const longs = Array.from(
    { length: Math.ceil((indices.length * bits) / 64) },
    () => 0n,
  );
  const mask = (1n << BigInt(bits)) - 1n;
  indices.forEach((value, index) => {
    const start = index * bits;
    const startLong = start >> 6;
    const endLong = ((index + 1) * bits - 1) >> 6;
    const offset = BigInt(start & 63);
    const v = BigInt(value) & mask;
    longs[startLong] = BigInt.asUintN(
      64,
      (longs[startLong] ?? 0n) | (v << offset),
    );
    if (startLong !== endLong) {
      longs[endLong] = BigInt.asUintN(
        64,
        (longs[endLong] ?? 0n) | (v >> (64n - offset)),
      );
    }
  });
  return longs.map((long) => [
    Number(BigInt.asIntN(32, long >> 32n)),
    Number(BigInt.asIntN(32, long & 0xff_ff_ff_ffn)),
  ]);
}

type RegionSpec = {
  position: [number, number, number];
  size: [number, number, number];
  palette: string[];
  /** YZX palette indices, length |x·y·z|. */
  indices: number[];
  tileEntities?: [number, number, number][];
};

const xyz = ([x, y, z]: [number, number, number]) => ({
  type: "compound" as const,
  value: {
    x: { type: "int" as const, value: x },
    y: { type: "int" as const, value: y },
    z: { type: "int" as const, value: z },
  },
});

function litematic(regions: Record<string, RegionSpec>): Uint8Array {
  const value: Record<string, nbt.Tags[nbt.TagType]> = {};
  for (const [name, region] of Object.entries(regions)) {
    const palette = region.palette.map((state) => {
      const [id = "", body] = state.split("[");
      const properties: Record<string, nbt.Tags[nbt.TagType]> = {};
      for (const pair of body === undefined
        ? []
        : body.replace("]", "").split(",")) {
        const [key = "", val = ""] = pair.split("=");
        properties[key] = { type: "string", value: val };
      }
      return {
        Name: { type: "string" as const, value: id },
        ...(body === undefined
          ? {}
          : { Properties: { type: "compound" as const, value: properties } }),
      };
    });
    value[name] = {
      type: "compound",
      value: {
        Position: xyz(region.position),
        Size: xyz(region.size),
        BlockStatePalette: {
          type: "list",
          value: { type: "compound", value: palette },
        },
        BlockStates: {
          type: "longArray",
          value: pack(region.indices, litematicBits(region.palette.length)),
        },
        TileEntities: {
          type: "list",
          value: {
            type: "compound",
            value: (region.tileEntities ?? []).map((pos) => xyz(pos).value),
          },
        },
      },
    };
  }
  const root: nbt.NBT = {
    type: "compound",
    name: "",
    value: {
      Version: { type: "int", value: 6 },
      MinecraftDataVersion: { type: "int", value: 4903 },
      Metadata: {
        type: "compound",
        value: {
          Name: { type: "string", value: "Fixture" },
          Author: { type: "string", value: "mc-build tests" },
        },
      },
      Regions: { type: "compound", value },
    },
  };
  return Bun.gzipSync(new Uint8Array(nbt.writeUncompressed(root, "big")));
}

describe("Litematica bit packing", () => {
  test("uses at least 2 bits and grows with the palette", () => {
    expect(
      [1, 2, 3, 4, 5, 16, 17, 32].map((size) => litematicBits(size)),
    ).toEqual([2, 2, 2, 2, 3, 4, 5, 5]);
  });

  test("decodes a hand-packed 2-bit long", () => {
    // 1 | 2<<2 | 3<<4 = 57
    expect([...unpackLitematicIndices([57n], 2, 4)]).toEqual([1, 2, 3, 0]);
  });

  test("decodes an entry that crosses a long boundary without padding", () => {
    // 5-bit entry 12 starts at bit 60: low 4 bits in long 0, top bit in long 1.
    const value = 0b1_0110;
    const longs = [BigInt(value & 0b1111) << 60n, BigInt(value >> 4)];
    expect(unpackLitematicIndices(longs, 5, 13)[12]).toBe(value);
  });

  test("round-trips widths that straddle longs", () => {
    for (const bits of [3, 5, 7, 11]) {
      const indices = Array.from(
        { length: 97 },
        (_, index) => (index * 37) % (1 << bits),
      );
      const longs = pack(indices, bits).map(([high, low]) =>
        BigInt.asUintN(64, (BigInt(high) << 32n) | BigInt(low >>> 0)),
      );
      expect([...unpackLitematicIndices(longs, bits, indices.length)]).toEqual(
        indices,
      );
    }
  });

  test("fails loudly when the long array is short", () => {
    expect(() => unpackLitematicIndices([0n], 5, 20)).toThrow(/needs 2 longs/u);
  });
});

describe("readLitematic", () => {
  test("reads a single region with states, metadata and block entities", async () => {
    // 3×2×2, YZX order.
    const palette = [
      "minecraft:air",
      "minecraft:stone",
      "minecraft:oak_stairs[facing=east,half=bottom]",
      "minecraft:chest",
    ];
    const indices = [1, 0, 2, 0, 0, 1, 3, 1, 1, 1, 1, 1];
    const info = await readLitematic(
      litematic({
        main: {
          position: [0, 0, 0],
          size: [3, 2, 2],
          palette,
          indices,
          tileEntities: [[0, 1, 0]],
        },
      }),
    );
    expect(info.grid.size).toEqual({ x: 3, y: 2, z: 2 });
    expect(info.name).toBe("Fixture");
    expect(info.author).toBe("mc-build tests");
    expect(info.dataVersion).toBe(4903);
    expect(info.grid.get(0, 0, 0)).toBe("minecraft:stone");
    expect(info.grid.get(1, 0, 0)).toBe("minecraft:air");
    expect(info.grid.get(2, 0, 0)).toBe(
      "minecraft:oak_stairs[facing=east,half=bottom]",
    );
    expect(info.grid.get(2, 0, 1)).toBe("minecraft:stone");
    expect(info.grid.get(0, 1, 0)).toBe("minecraft:chest");
    expect(info.grid.blockEntities).toEqual([
      { pos: { x: 0, y: 1, z: 0 }, id: "minecraft:chest" },
    ]);
  });

  test("merges regions and honors negative sizes", async () => {
    const info = await readLitematic(
      litematic({
        a: {
          position: [0, 0, 0],
          size: [2, 1, 1],
          palette: ["minecraft:air", "minecraft:stone"],
          indices: [1, 1],
        },
        // Size -2 from x=5 covers x 4..5; local x 0 is the min corner (x=4).
        b: {
          position: [5, 1, 0],
          size: [-2, 1, 1],
          palette: [
            "minecraft:air",
            "minecraft:gold_block",
            "minecraft:iron_block",
          ],
          indices: [1, 2],
        },
      }),
    );
    expect(info.grid.size).toEqual({ x: 6, y: 2, z: 1 });
    expect(info.regions).toEqual([
      { name: "a", min: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 1, z: 1 } },
      { name: "b", min: { x: 4, y: 1, z: 0 }, size: { x: 2, y: 1, z: 1 } },
    ]);
    expect(info.grid.get(1, 0, 0)).toBe("minecraft:stone");
    expect(info.grid.get(4, 1, 0)).toBe("minecraft:gold_block");
    expect(info.grid.get(5, 1, 0)).toBe("minecraft:iron_block");
    expect(info.grid.get(3, 0, 0)).toBe("minecraft:air");
  });

  test("decodes a wide palette across long boundaries", async () => {
    const palette = [
      "minecraft:air",
      ...Array.from(
        { length: 20 },
        (_, index) => `minecraft:stone_${index.toString()}`,
      ),
    ];
    const indices = Array.from(
      { length: 5 * 3 * 4 },
      (_, index) => (index * 7) % palette.length,
    );
    const info = await readLitematic(
      litematic({
        wide: { position: [0, 0, 0], size: [5, 3, 4], palette, indices },
      }),
    );
    for (let y = 0; y < 3; y += 1) {
      for (let z = 0; z < 4; z += 1) {
        for (let x = 0; x < 5; x += 1) {
          expect(info.grid.get(x, y, z)).toBe(
            palette[indices[(y * 4 + z) * 5 + x] ?? 0],
          );
        }
      }
    }
  });
});
