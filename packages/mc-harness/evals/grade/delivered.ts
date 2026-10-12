/**
 * Did the agent deliver what the task asked for? These checks read the
 * promoted grid, so a task that asked for a 160×160 village cannot pass with
 * a 20×20 cottage, and a "lighthouse on a cove" needs a tall build and water.
 * They say nothing about looks — the bench judge does that.
 */
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { blockId } from "@shepherdjerred/mc-build/core/block-state.ts";
import { repetitionRatio } from "@shepherdjerred/mc-build/lint/repetition.ts";
import type { GradeCheck } from "#evals/lib/types.ts";

export type Feature =
  | "door"
  | "window"
  | "roofStairs"
  | "light"
  | "furniture"
  | "path"
  | "tree"
  | "water"
  | "fence";

export type DeliveredSpec = {
  /** Smallest footprint of edits against the site, or non-ground blocks without one. */
  minFootprint?: { w: number; d: number };
  /** Smallest height of those edits or non-ground blocks. */
  minHeight?: number;
  minBlocks?: number;
  features?: readonly Feature[];
  maxLintWarnings?: number;
  maxRepeatRatio?: number;
};

/** Block-id patterns that count as evidence of a feature. */
const FEATURE_PATTERNS: Record<Feature, { pattern: RegExp; min: number }> = {
  door: { pattern: /_door$/u, min: 1 },
  window: { pattern: /glass/u, min: 1 },
  roofStairs: { pattern: /_stairs$/u, min: 12 },
  light: {
    pattern:
      /lantern|torch|glowstone|candle|campfire|_lamp$|shroomlight|froglight/u,
    min: 1,
  },
  furniture: {
    pattern:
      /_bed$|bookshelf|crafting_table|barrel|chest$|loom|smoker|furnace|lectern|flower_pot|cauldron|anvil/u,
    min: 1,
  },
  /** Path and tree are shapes, not block counts: see `pathRun` and `treeCount`. */
  path: {
    pattern: /dirt_path|gravel|packed_mud|cobblestone$|mud_bricks/u,
    min: 8,
  },
  tree: { pattern: /_log$/u, min: 1 },
  water: { pattern: /^water$|water_cauldron|kelp|seagrass|lily_pad/u, min: 4 },
  fence: { pattern: /_fence$|_wall$|_fence_gate$/u, min: 2 },
};

function idAt(grid: BlockGrid, x: number, y: number, z: number): string {
  return blockId(grid.get(x, y, z)).replace(/^minecraft:/u, "");
}

/** True when the cell holds a block whose id matches. */
function hasBlock(
  grid: BlockGrid,
  [x, y, z]: readonly [number, number, number],
  matches: (id: string) => boolean,
): boolean {
  return (
    grid.inBounds(x, y, z) &&
    !grid.isAirAt(x, y, z) &&
    matches(idAt(grid, x, y, z))
  );
}

/** True when the cell is open: outside the grid above it, or air. */
function openAbove(grid: BlockGrid, x: number, y: number, z: number): boolean {
  return y + 1 >= grid.size.y || grid.isAirAt(x, y + 1, z);
}

const key = (x: number, y: number, z: number): string =>
  `${x.toString()},${y.toString()},${z.toString()}`;

/** The eight cells a path cell can continue to: one step in x or z, level or one block up or down. */
function pathNeighbours(cell: string): string[] {
  const [x = 0, y = 0, z = 0] = cell.split(",").map(Number);
  const steps = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  return steps.flatMap(([dx, dz]) =>
    [-1, 0, 1].map((dy) => key(x + dx, y + dy, z + dz)),
  );
}

/** The size of the connected component of `cells` that holds `start`, marking it in `seen`. */
function componentSize(
  cells: ReadonlySet<string>,
  start: string,
  seen: Set<string>,
): number {
  const queue = [start];
  seen.add(start);
  let size = 0;
  for (const cell of queue) {
    size += 1;
    for (const next of pathNeighbours(cell)) {
      if (cells.has(next) && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return size;
}

/**
 * The longest connected run of walkable path blocks: path-pattern cells with
 * nothing on top, joined to a neighbour in x or z one step up, down or level.
 * Cobblestone under a wall has the wall on top and is never a path.
 */
export function pathRun(grid: BlockGrid): number {
  const { pattern } = FEATURE_PATTERNS.path;
  const cells = new Set<string>();
  grid.forEach((x, y, z) => {
    if (
      hasBlock(grid, [x, y, z], (id) => pattern.test(id)) &&
      openAbove(grid, x, y, z)
    ) {
      cells.add(key(x, y, z));
    }
  });
  let longest = 0;
  const seen = new Set<string>();
  for (const start of cells) {
    if (!seen.has(start)) {
      longest = Math.max(longest, componentSize(cells, start, seen));
    }
  }
  return longest;
}

/** The cells within two blocks sideways and from one below to three above (x, y, z). */
function canopyCells(
  x: number,
  y: number,
  z: number,
): [number, number, number][] {
  const cells: [number, number, number][] = [];
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      for (let dy = -1; dy <= 3; dy += 1) cells.push([x + dx, y + dy, z + dz]);
    }
  }
  return cells;
}

/**
 * Trees: trunks of at least three logs with a canopy of at least six leaves
 * around the top. A timber frame's corner posts have no canopy.
 */
export function treeCount(grid: BlockGrid): number {
  const { pattern } = FEATURE_PATTERNS.tree;
  const isLog = (x: number, y: number, z: number): boolean =>
    hasBlock(grid, [x, y, z], (id) => pattern.test(id));
  const isLeaves = (cell: readonly [number, number, number]): boolean =>
    hasBlock(grid, cell, (id) => id.endsWith("_leaves"));
  let trees = 0;
  grid.forEach((x, y, z) => {
    const trunkTop =
      isLog(x, y, z) &&
      isLog(x, y - 1, z) &&
      isLog(x, y - 2, z) &&
      !isLog(x, y + 1, z);
    if (
      trunkTop &&
      canopyCells(x, y, z).filter((cell) => isLeaves(cell)).length >= 6
    ) {
      trees += 1;
    }
  });
  return trees;
}

type Built = {
  blocks: number;
  size: { w: number; d: number; h: number } | null;
  counts: Map<string, number>;
};

/**
 * Blocks a flat or captured site already has: soil, rock, sand, water, snow
 * and plants. Everything else (including placed logs and leaves, which are
 * scenery the agent made) counts as built.
 */
const NATURAL =
  /^(?:grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|mud|stone|deepslate|granite|diorite|andesite|tuff|calcite|gravel|sand|red_sand|clay|bedrock|water|lava|snow|snow_block|ice|packed_ice|blue_ice|moss_block|short_grass|tall_grass|fern|large_fern|dead_bush|seagrass|tall_seagrass|kelp|kelp_plant|sugar_cane|.*_flower|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|pink_petals|leaf_litter|wildflowers|bush)$/u;

export function isNatural(id: string): boolean {
  return NATURAL.test(id);
}

/**
 * The promoted grid with every cell the captured site already had turned to
 * air: surviving placements used as feature evidence. Deletions also appear
 * as air; use builtExtent or baseline repetition to measure all edits.
 * Sizes must match (both are the site box).
 */
export function changedGrid(grid: BlockGrid, site: BlockGrid): BlockGrid {
  assertSiteSize(grid, site);
  const changed = new BlockGrid(grid.size);
  grid.forEach((x, y, z, state) => {
    if (state !== site.get(x, y, z)) changed.set(x, y, z, state);
  });
  return changed;
}

function assertSiteSize(grid: BlockGrid, site: BlockGrid): void {
  if (
    grid.size.x !== site.size.x ||
    grid.size.y !== site.size.y ||
    grid.size.z !== site.size.z
  ) {
    throw new Error(
      `promoted grid ${grid.size.x.toString()}×${grid.size.y.toString()}×${grid.size.z.toString()} and captured site ${site.size.x.toString()}×${site.size.y.toString()}×${site.size.z.toString()} differ in size`,
    );
  }
}

/**
 * Everything built, with its bounding box. With a captured `site`, built
 * means changed since capture (excavations count, untouched ground does
 * not); without one, built means not air and not natural terrain.
 */
export function builtExtent(grid: BlockGrid, site?: BlockGrid): Built {
  if (site !== undefined) assertSiteSize(grid, site);
  const counts = new Map<string, number>();
  const box = new Bounds();
  grid.forEach((x, y, z, state) => {
    if (state === site?.get(x, y, z)) return;
    if (grid.isAirAt(x, y, z)) {
      if (site !== undefined) box.extend(x, y, z);
      return;
    }
    const id = blockId(state).replace(/^minecraft:/u, "");
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (site === undefined && isNatural(id)) return;
    box.extend(x, y, z);
  });
  return { blocks: box.blocks, size: box.size(), counts };
}

/** A running bounding box over the built cells. */
class Bounds {
  blocks = 0;
  private min = { x: Infinity, y: Infinity, z: Infinity };
  private max = { x: -Infinity, y: -Infinity, z: -Infinity };

  extend(x: number, y: number, z: number): void {
    this.blocks += 1;
    this.min = {
      x: Math.min(this.min.x, x),
      y: Math.min(this.min.y, y),
      z: Math.min(this.min.z, z),
    };
    this.max = {
      x: Math.max(this.max.x, x),
      y: Math.max(this.max.y, y),
      z: Math.max(this.max.z, z),
    };
  }

  size(): Built["size"] {
    return this.blocks === 0
      ? null
      : {
          w: this.max.x - this.min.x + 1,
          d: this.max.z - this.min.z + 1,
          h: this.max.y - this.min.y + 1,
        };
  }
}

function featureCount(counts: Map<string, number>, feature: Feature): number {
  const { pattern } = FEATURE_PATTERNS[feature];
  let total = 0;
  for (const [id, count] of counts) {
    if (pattern.test(id)) total += count;
  }
  return total;
}

function sizeChecks(spec: DeliveredSpec, built: Built): GradeCheck[] {
  const checks: GradeCheck[] = [];
  const size = built.size;
  if (spec.minFootprint !== undefined) {
    const want = spec.minFootprint;
    checks.push({
      name: `built footprint at least ${want.w.toString()}×${want.d.toString()}`,
      pass:
        size !== null &&
        ((size.w >= want.w && size.d >= want.d) ||
          (size.w >= want.d && size.d >= want.w)),
      detail:
        size === null
          ? "nothing built"
          : `${size.w.toString()}×${size.d.toString()}`,
    });
  }
  if (spec.minHeight !== undefined) {
    checks.push({
      name: `built height at least ${spec.minHeight.toString()}`,
      pass: size !== null && size.h >= spec.minHeight,
      detail: size === null ? "nothing built" : `${size.h.toString()} tall`,
    });
  }
  if (spec.minBlocks !== undefined) {
    checks.push({
      name: `at least ${spec.minBlocks.toString()} built blocks`,
      pass: built.blocks >= spec.minBlocks,
      detail: `${built.blocks.toString()} built edits`,
    });
  }
  return checks;
}

export function deliveredChecks(
  grid: BlockGrid,
  spec: DeliveredSpec,
  lintWarnings: number | null,
  site?: BlockGrid,
): GradeCheck[] {
  const built = builtExtent(grid, site);
  const checks = sizeChecks(spec, built);
  const subject = site === undefined ? grid : changedGrid(grid, site);
  for (const feature of spec.features ?? []) {
    const { min } = FEATURE_PATTERNS[feature];
    const evidence =
      feature === "path"
        ? { count: pathRun(subject), what: "connected walkable path cells" }
        : feature === "tree"
          ? { count: treeCount(subject), what: "trunk(s) with a canopy" }
          : {
              count: featureCount(built.counts, feature),
              what: "matching blocks",
            };
    checks.push({
      name: `has ${feature}`,
      pass: evidence.count >= min,
      detail: `${evidence.count.toString()} ${evidence.what}`,
    });
  }
  if (spec.maxLintWarnings !== undefined) {
    checks.push({
      name: `at most ${spec.maxLintWarnings.toString()} lint warnings`,
      pass: lintWarnings !== null && lintWarnings <= spec.maxLintWarnings,
      detail:
        lintWarnings === null
          ? "lint did not run"
          : `${lintWarnings.toString()} warning(s)`,
    });
  }
  if (spec.maxRepeatRatio !== undefined) {
    // Measured on what changed, so a captured site's own layers never count as copies.
    const ratio = repetitionRatio(
      grid,
      site === undefined ? {} : { baseline: site },
    ).ratio;
    checks.push({
      name: `repetition ratio at most ${spec.maxRepeatRatio.toString()}`,
      pass: ratio <= spec.maxRepeatRatio,
      detail: ratio.toFixed(2),
    });
  }
  return checks;
}
