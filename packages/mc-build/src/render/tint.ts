/** Fixed plains-biome colours for tinted faces (grass, foliage, water). */
export type Rgb = [number, number, number];

export const GRASS: Rgb = [0x91 / 255, 0xbd / 255, 0x59 / 255];
const FOLIAGE: Rgb = [0x77 / 255, 0xab / 255, 0x2f / 255];
const BIRCH: Rgb = [0x80 / 255, 0xa7 / 255, 0x55 / 255];
const SPRUCE: Rgb = [0x61 / 255, 0x99 / 255, 0x61 / 255];
const WATER: Rgb = [0x3f / 255, 0x76 / 255, 0xe4 / 255];
const LILY: Rgb = [0x20 / 255, 0x80 / 255, 0x30 / 255];
const NONE: Rgb = [1, 1, 1];
/** Leaves whose models carry a tint index but the game draws untinted. */
const UNTINTED_LEAVES = new Set([
  "minecraft:cherry_leaves",
  "minecraft:azalea_leaves",
  "minecraft:flowering_azalea_leaves",
  "minecraft:pale_oak_leaves",
]);

export function tintFor(id: string): Rgb {
  if (UNTINTED_LEAVES.has(id)) {
    return NONE;
  }
  if (id === "minecraft:birch_leaves") {
    return BIRCH;
  }
  if (id === "minecraft:spruce_leaves") {
    return SPRUCE;
  }
  if (id === "minecraft:vine" || id.endsWith("_leaves")) {
    return FOLIAGE;
  }
  if (id.includes("water") || id.includes("bubble_column")) {
    return WATER;
  }
  return id === "minecraft:lily_pad" ? LILY : GRASS;
}
