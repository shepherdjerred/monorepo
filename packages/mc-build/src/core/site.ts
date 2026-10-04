import { createHash } from "node:crypto";
import { z } from "zod";
import { blockId, isAir } from "./block-state.ts";
import type { BlockGrid, Vec3 } from "./grid.ts";

const PLANTS =
  "short_grass|tall_grass|fern|large_fern|vine|sweet_berry_bush|bamboo|.*_flower|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|pink_petals|leaf_litter|wildflowers|bush|firefly_bush|short_dry_grass|tall_dry_grass";

/** Blocks that never count as ground for heightmaps and support. */
const NON_GROUND = new RegExp(
  `(?:_leaves|_sapling|^minecraft:(?:${PLANTS}|dead_bush|snow|torch|wall_torch|water|lava|bubble_column|seagrass|tall_seagrass|kelp|kelp_plant|sugar_cane|cactus|wither_rose))$`,
  "u",
);
const VEGETATION = new RegExp(
  `(?:_leaves|_log|_sapling|^minecraft:(?:${PLANTS}))$`,
  "u",
);

export function isGround(state: string): boolean {
  return !isAir(state) && !NON_GROUND.test(blockId(state));
}

export const SiteInfoSchema = z.strictObject({
  version: z.literal(1),
  world: z.string(),
  min: z.strictObject({
    x: z.number().int(),
    y: z.number().int(),
    z: z.number().int(),
  }),
  size: z.strictObject({
    x: z.number().int(),
    y: z.number().int(),
    z: z.number().int(),
  }),
  /** Per column (index z * size.x + x): world y of the first free cell above ground, or null. */
  heightmap: z.array(z.number().int().nullable()),
  /** Per column: 1 where the top non-air block is water. */
  water: z.array(z.union([z.literal(0), z.literal(1)])),
  /** Per column: 1 where trees or plants stand above the ground. */
  vegetation: z.array(z.union([z.literal(0), z.literal(1)])),
  /** Ground surface blocks, most common first. */
  surface: z.array(
    z.strictObject({ state: z.string(), count: z.number().int() }),
  ),
  /** sha256 of the captured blocks; detects the site changing under a build. */
  siteHash: z.string().regex(/^[0-9a-f]{64}$/u),
});
export type SiteInfo = z.infer<typeof SiteInfoSchema>;

export function gridHash(grid: BlockGrid): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(grid.size));
  for (const value of grid.data) {
    hash.update(grid.palette[value] ?? "");
    hash.update("\n");
  }
  return hash.digest("hex");
}

type Column = {
  height: number | null;
  water: boolean;
  plants: boolean;
  ground: string | null;
};

/** Scans one column top-down for the first ground block. */
function scanColumn(
  grid: BlockGrid,
  cx: number,
  cz: number,
  minY: number,
): Column {
  const column: Column = {
    height: null,
    water: false,
    plants: false,
    ground: null,
  };
  let sawTop = false;
  for (let y = grid.size.y - 1; y >= 0; y -= 1) {
    const state = grid.get(cx, y, cz);
    if (isAir(state)) {
      continue;
    }
    const id = blockId(state);
    column.water ||= !sawTop && id === "minecraft:water";
    sawTop = true;
    column.plants ||= VEGETATION.test(id);
    if (isGround(state)) {
      column.height = minY + y + 1;
      column.ground = state;
      return column;
    }
  }
  return column;
}

/** Heightmap, water/vegetation masks and surface mix of a captured region. */
export function analyzeSite(
  grid: BlockGrid,
  world: string,
  min: Vec3,
): SiteInfo {
  const heightmap: (number | null)[] = [];
  const water: (0 | 1)[] = [];
  const vegetation: (0 | 1)[] = [];
  const surface = new Map<string, number>();
  for (let cz = 0; cz < grid.size.z; cz += 1) {
    for (let cx = 0; cx < grid.size.x; cx += 1) {
      const column = scanColumn(grid, cx, cz, min.y);
      heightmap.push(column.height);
      water.push(column.water ? 1 : 0);
      vegetation.push(column.plants ? 1 : 0);
      if (column.ground !== null) {
        surface.set(column.ground, (surface.get(column.ground) ?? 0) + 1);
      }
    }
  }
  return SiteInfoSchema.parse({
    version: 1,
    world,
    min,
    size: grid.size,
    heightmap,
    water,
    vegetation,
    surface: [...surface]
      .map(([state, count]) => ({ state, count }))
      .toSorted((a, b) => b.count - a.count)
      .slice(0, 10),
    siteHash: gridHash(grid),
  });
}
