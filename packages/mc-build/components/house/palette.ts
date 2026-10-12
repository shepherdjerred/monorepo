/** House palettes by style (see the building skill's palettes reference). */
import type { BuildContext } from "@shepherdjerred/mc-build/dsl/context.ts";
import type { Material } from "@shepherdjerred/mc-build/dsl/types.ts";

export type HouseStyle =
  "medieval" | "tudor" | "rustic" | "nordic" | "desert" | "stone";

export type Palette = {
  foundation: Material;
  frame: string;
  infill: Material;
  upper: Material;
  roof: string;
  mansard: string;
  trim: string;
  floor: string;
  door: string;
  shutter: string | null;
  chimney: Material;
  porchPost: string;
  porchFloor: string;
};

type Weighted = readonly (readonly [string, number])[];

function pick<T>(items: readonly [T, ...T[]], variant: number): T {
  return items[variant % items.length] ?? items[0];
}

function shared(ctx: BuildContext) {
  const mix = (entries: Weighted) => ctx.mat.noise(entries, { scale: 2 });
  return {
    stone: mix([
      ["cobblestone", 5],
      ["stone_bricks", 3],
      ["andesite", 2],
      ["mossy_cobblestone", 1],
    ]),
    brick: mix([
      ["bricks", 5],
      ["stone_bricks", 2],
    ]),
    plaster: ctx.mat.noise(
      [
        ["white_terracotta", 6],
        ["calcite", 3],
        ["smooth_sandstone", 1],
      ],
      { scale: 3 },
    ),
    mix,
  };
}

const TIMBER = {
  medieval: (ctx: BuildContext, v: number): Palette => {
    const { stone, brick, plaster } = shared(ctx);
    return {
      foundation: stone,
      frame: "stripped_spruce_log",
      infill: plaster,
      upper: pick(
        [
          plaster,
          ctx.mat.block("spruce_planks"),
          ctx.mat.block("yellow_terracotta"),
        ],
        v,
      ),
      roof: pick(
        ["dark_oak_stairs", "spruce_stairs", "deepslate_tile_stairs"],
        v,
      ),
      mansard: "deepslate_tiles",
      trim: "spruce_planks",
      floor: "spruce_planks",
      door: "spruce_door",
      shutter: "spruce_trapdoor",
      chimney: brick,
      porchPost: "spruce_fence",
      porchFloor: "spruce_planks",
    };
  },
  tudor: (ctx: BuildContext, v: number): Palette => {
    const { stone, brick, plaster } = shared(ctx);
    return {
      foundation: stone,
      frame: pick(["dark_oak_log", "stripped_dark_oak_log"], v),
      infill: plaster,
      upper: plaster,
      roof: pick(["spruce_stairs", "dark_oak_stairs"], v),
      mansard: "dark_oak_planks",
      trim: "dark_oak_planks",
      floor: "dark_oak_planks",
      door: "dark_oak_door",
      shutter: "dark_oak_trapdoor",
      chimney: brick,
      porchPost: "dark_oak_fence",
      porchFloor: "dark_oak_planks",
    };
  },
  rustic: (ctx: BuildContext, v: number): Palette => {
    const { stone } = shared(ctx);
    return {
      foundation: stone,
      frame: "spruce_log",
      infill: ctx.mat.palette([
        ["oak_planks", 5],
        ["stripped_oak_log", 1],
      ]),
      upper: pick(
        [
          ctx.mat.block("oak_planks"),
          ctx.mat.block("birch_planks"),
          ctx.mat.block("stripped_birch_log"),
        ],
        v,
      ),
      roof: pick(["dark_oak_stairs", "spruce_stairs"], v),
      mansard: "spruce_planks",
      trim: "spruce_planks",
      floor: "oak_planks",
      door: "oak_door",
      shutter: "spruce_trapdoor",
      chimney: stone,
      porchPost: "oak_fence",
      porchFloor: "oak_planks",
    };
  },
  nordic: (ctx: BuildContext, v: number): Palette => {
    const { stone, mix } = shared(ctx);
    return {
      foundation: mix([
        ["cobblestone", 4],
        ["mossy_cobblestone", 2],
        ["cobbled_deepslate", 2],
      ]),
      frame: "dark_oak_log",
      infill: ctx.mat.block("spruce_planks"),
      upper: pick(
        [ctx.mat.block("spruce_planks"), ctx.mat.block("stripped_spruce_log")],
        v,
      ),
      roof: pick(["deepslate_tile_stairs", "spruce_stairs"], v),
      mansard: "deepslate_tiles",
      trim: "dark_oak_planks",
      floor: "spruce_planks",
      door: "dark_oak_door",
      shutter: "dark_oak_trapdoor",
      chimney: stone,
      porchPost: "dark_oak_fence",
      porchFloor: "spruce_planks",
    };
  },
};

const MASONRY = {
  desert: (ctx: BuildContext, v: number): Palette => {
    const { mix } = shared(ctx);
    return {
      foundation: mix([
        ["sandstone", 4],
        ["cut_sandstone", 2],
      ]),
      frame: "stripped_acacia_log",
      infill: ctx.mat.palette([
        ["smooth_sandstone", 5],
        ["sandstone", 2],
      ]),
      upper: ctx.mat.block("smooth_sandstone"),
      roof: pick(
        ["smooth_sandstone_stairs", "granite_stairs", "mud_brick_stairs"],
        v,
      ),
      mansard: "mud_bricks",
      trim: "acacia_planks",
      floor: "acacia_planks",
      door: "acacia_door",
      shutter: "acacia_trapdoor",
      chimney: ctx.mat.block("mud_bricks"),
      porchPost: "acacia_fence",
      porchFloor: "acacia_planks",
    };
  },
  stone: (ctx: BuildContext, v: number): Palette => {
    const { stone, plaster, mix } = shared(ctx);
    return {
      foundation: mix([
        ["cobbled_deepslate", 3],
        ["cobblestone", 3],
        ["mossy_cobblestone", 1],
      ]),
      frame: "stripped_spruce_log",
      infill: mix([
        ["stone_bricks", 6],
        ["cracked_stone_bricks", 1],
        ["andesite", 2],
      ]),
      upper: pick(
        [
          plaster,
          mix([
            ["stone_bricks", 6],
            ["mossy_stone_bricks", 1],
          ]),
        ],
        v,
      ),
      roof: pick(["deepslate_tile_stairs", "dark_oak_stairs"], v),
      mansard: "deepslate_tiles",
      trim: "spruce_planks",
      floor: "spruce_planks",
      door: "spruce_door",
      shutter: null,
      chimney: stone,
      porchPost: "spruce_fence",
      porchFloor: "spruce_planks",
    };
  },
};

/** Timber styles get jetties and porches; masonry styles do not. */
export function isTimber(style: HouseStyle): boolean {
  return style in TIMBER;
}

export function housePalette(
  ctx: BuildContext,
  style: HouseStyle,
  variant: number,
): Palette {
  const make = { ...TIMBER, ...MASONRY }[style];
  return make(ctx, variant);
}
