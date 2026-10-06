import type { BlockGrid } from "#src/core/grid.ts";
import type { SiteInfo } from "#src/core/site.ts";
import type { BlockRegistry } from "#src/registry/registry.ts";
import { BuildCanvas } from "./canvas.ts";
import { createCraft, type Craft } from "./craft.ts";
import { geo, type Geo } from "./geo.ts";
import {
  createMat,
  fractalNoise,
  hash01,
  type Mat,
  type NoiseOptions,
} from "./mat.ts";
import {
  AIR,
  KEEP,
  type Box,
  type Material,
  type Region,
  type Site,
  type Vec3,
} from "./types.ts";

/** Everything a build program receives. */
export type BuildContext = {
  set: (x: number, y: number, z: number, material: Material) => void;
  get: (x: number, y: number, z: number) => string;
  fill: (region: Region | Box, material: Material) => void;
  clear: (region: Region | Box) => void;
  geo: Geo;
  mat: Mat;
  craft: Craft;
  /** Terrain in local coordinates, when compiled with a captured site. */
  site: Site | null;
  /** Deterministic random numbers in [0, 1) for this build's seed. */
  rng: () => number;
  /**
   * Deterministic 2D fractal noise in [0, 1) at (x, z) for this build's seed:
   * terrain heights, coastlines, vegetation and material masks.
   */
  noise: (x: number, z: number, options?: NoiseOptions) => number;
  log: (message: string) => void;
  KEEP: typeof KEEP;
  AIR: typeof AIR;
};

/**
 * A build program: the default export of a build.ts module.
 *
 *   import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";
 *   export default ((ctx) => { … }) satisfies BuildProgram;
 */
export type BuildProgram = (ctx: BuildContext) => void | Promise<void>;

function discardLog(): void {
  // Programs may log; without a collector the messages are dropped.
}

/** Site view in build-local coordinates for a build anchored at `anchor`. */
export function siteView(info: SiteInfo, grid: BlockGrid, anchor: Vec3): Site {
  const column = (x: number, z: number) => {
    const wx = anchor.x + x - info.min.x;
    const wz = anchor.z + z - info.min.z;
    return wx < 0 || wz < 0 || wx >= info.size.x || wz >= info.size.z
      ? null
      : { wx, wz };
  };
  return {
    heightAt: (x, z) => {
      const at = column(x, z);
      if (at === null) {
        return null;
      }
      const height = info.heightmap[at.wz * info.size.x + at.wx];
      return height === null || height === undefined ? null : height - anchor.y;
    },
    blockAt: (x, y, z) => {
      const at = column(x, z);
      const wy = anchor.y + y - info.min.y;
      return at === null || wy < 0 || wy >= info.size.y
        ? null
        : grid.get(at.wx, wy, at.wz);
    },
  };
}

export function createBuildContext(options: {
  registry: BlockRegistry;
  seed: number;
  site: Site | null;
  log?: (message: string) => void;
}): { ctx: BuildContext; canvas: BuildCanvas } {
  const canvas = new BuildCanvas(options.registry);
  const mat = createMat(options.registry, options.seed);
  let counter = 0;
  const ctx: BuildContext = {
    set: (x, y, z, material) => {
      canvas.set(x, y, z, material);
    },
    get: (x, y, z) => canvas.get(x, y, z),
    fill: (region, material) => {
      canvas.fill(region, material);
    },
    clear: (region) => {
      canvas.clear(region);
    },
    geo,
    mat,
    craft: createCraft(canvas, mat, options.site),
    site: options.site,
    rng: () => {
      counter += 1;
      return hash01(counter, 0, 0, options.seed);
    },
    noise: (x, z, noiseOptions) =>
      fractalNoise(x, z, options.seed, noiseOptions),
    log: options.log ?? discardLog,
    KEEP,
    AIR,
  };
  return { ctx, canvas };
}
