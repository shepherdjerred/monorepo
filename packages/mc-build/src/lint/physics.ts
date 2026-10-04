/**
 * Small hand-maintained block-behaviour tables for lint. test/lint.test.ts
 * checks every exact id here exists in the committed registry so stale names
 * fail loudly on version bumps.
 */

/** Falls when unsupported. */
export const GRAVITY_IDS: readonly string[] = [
  "minecraft:sand",
  "minecraft:red_sand",
  "minecraft:gravel",
  "minecraft:suspicious_sand",
  "minecraft:suspicious_gravel",
  "minecraft:anvil",
  "minecraft:chipped_anvil",
  "minecraft:damaged_anvil",
  "minecraft:dragon_egg",
  "minecraft:scaffolding",
];

export function isGravity(id: string): boolean {
  return GRAVITY_IDS.includes(id) || id.endsWith("_concrete_powder");
}

export type Support = "below" | "above" | "behind" | "face";

const BEHIND =
  /(?:_wall_torch|_wall_sign|_wall_hanging_sign|_wall_banner|^ladder|_wall_head|_wall_skull|^wall_torch|^tripwire_hook|^cocoa)$/u;
const FACE = /(?:_button|^lever|^grindstone)$/u;
const BELOW =
  /(?:^torch|^soul_torch|^redstone_torch|_sign|_banner|_carpet|_pressure_plate|_sapling|^rail|_rail|^repeater|^comparator|^redstone_wire|^short_grass|^tall_grass|^fern|^large_fern|^dandelion|^poppy|_tulip|^cornflower|^allium|^azure_bluet|^blue_orchid|^oxeye_daisy|^lily_of_the_valley|^sunflower|^lilac|^rose_bush|^peony|^flower_pot|^potted_.*|^snow|^candle|_candle|^sea_pickle|^dead_bush)$/u;

/**
 * Where a block needs a neighbour to survive. `behind` means opposite its
 * `facing`; `face` reads the `face` property (floor/ceiling/wall) of buttons
 * and levers.
 */
export function supportOf(
  id: string,
  properties: Readonly<Record<string, string>>,
): Support | null {
  const name = id.replace(/^minecraft:/u, "");
  if (BEHIND.test(name)) {
    return "behind";
  }
  if (FACE.test(name)) {
    return "face";
  }
  if (name === "lantern" || name === "soul_lantern") {
    return properties["hanging"] === "true" ? "above" : "below";
  }
  if (name.endsWith("_hanging_sign")) {
    return "above";
  }
  if (BELOW.test(name)) {
    return "below";
  }
  if (name.endsWith("_door")) {
    return properties["half"] === "lower" ? "below" : null;
  }
  return null;
}

const FULL_LIGHT =
  /^(?:glowstone|sea_lantern|jack_o_lantern|shroomlight|beacon|conduit|lava|fire|end_gateway|respawn_anchor|ochre_froglight|verdant_froglight|pearlescent_froglight|lantern|campfire)$/u;
const SOUL_LIGHT =
  /^(?:soul_lantern|soul_torch|soul_wall_torch|soul_campfire|soul_fire)$/u;

/** Block light emitted (0–15), for the dark-interior check. */
export function lightOf(
  id: string,
  properties: Readonly<Record<string, string>>,
): number {
  const name = id.replace(/^minecraft:/u, "");
  const lit = properties["lit"];
  if (FULL_LIGHT.test(name)) {
    return lit === "false" ? 0 : 15;
  }
  if (name === "torch" || name === "wall_torch" || name === "end_rod") {
    return 14;
  }
  if (SOUL_LIGHT.test(name)) {
    return lit === "false" ? 0 : 10;
  }
  if (name === "redstone_lamp") {
    return lit === "true" ? 15 : 0;
  }
  return lit === "true" && name.endsWith("candle")
    ? 3 * Number(properties["candles"] ?? "1")
    : 0;
}

const PASSABLE =
  /(?:^air|^cave_air|^void_air|_carpet|_pressure_plate|^torch|_torch|^lantern|_lantern|_sign|_banner|^short_grass|^tall_grass|^fern|_sapling|^rail|_rail|^redstone_wire|^light|^snow)$/u;

/** Blocks light and mobs pass through for enclosure purposes (not walls). */
export function isPassable(id: string): boolean {
  return PASSABLE.test(id.replace(/^minecraft:/u, ""));
}

export function isLeaves(id: string): boolean {
  return id.endsWith("_leaves");
}

export function isLog(id: string): boolean {
  return /(?:_log|_wood|_stem|_hyphae)$/u.test(id);
}
