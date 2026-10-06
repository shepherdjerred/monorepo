import { parseBlockState, withProperties } from "#src/core/block-state.ts";
import type { BlockRegistry } from "#src/registry/registry.ts";
import { WORLD_FACING, type Dir, type Material } from "./types.ts";

/** Deterministic hash of a cell and seed to [0, 1). */
export function hash01(x: number, y: number, z: number, seed: number): number {
  let h =
    Math.imul(x, 0x27_d4_eb_2d) ^
    Math.imul(y, 0x16_56_67_b1) ^
    Math.imul(z, 0x58_5a_3f_6d);
  h = Math.imul(h ^ seed, 0x2c_1b_3c_6d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x29_7a_2d_39);
  h ^= h >>> 15;
  return (h >>> 0) / 4_294_967_296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function namespaced(id: string): string {
  return `minecraft:${id.replace(/^minecraft:/u, "")}`;
}

/** World facing for a build-relative direction (front = south). */
function facing(dir: Dir): string {
  return WORLD_FACING[dir];
}

/** Name stems a stone-like block's stairs/slab/wall variants might use. */
function stoneCandidates(name: string): string[] {
  return [
    name,
    name.replace(/_bricks$/u, "_brick"),
    name.replace(/_tiles$/u, "_tile"),
    name.replace(/_block$/u, ""),
    name.replace(/s$/u, ""),
    name.replace(/_planks$/u, ""),
  ];
}

/** Trilinear value noise in [0, 1) at `point` scaled down by `scale`. */
export function valueNoise(
  point: readonly [x: number, y: number, z: number],
  scale: number,
  seed: number,
): number {
  const [x, y, z] = point;
  const fx = x / scale;
  const fy = y / scale;
  const fz = z / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const tz = smooth(fz - z0);
  const corner = (dx: number, dy: number, dz: number) =>
    hash01(x0 + dx, y0 + dy, z0 + dz, seed);
  return lerp(
    lerp(
      lerp(corner(0, 0, 0), corner(1, 0, 0), tx),
      lerp(corner(0, 1, 0), corner(1, 1, 0), tx),
      ty,
    ),
    lerp(
      lerp(corner(0, 0, 1), corner(1, 0, 1), tx),
      lerp(corner(0, 1, 1), corner(1, 1, 1), tx),
      ty,
    ),
    tz,
  );
}

export type NoiseOptions = {
  /** Feature size in blocks (default 24). */
  scale?: number;
  /** Layers of finer detail, each half the size and amplitude (default 4). */
  octaves?: number;
  /** Ridged noise for mountain crests and valleys (default false). */
  ridged?: boolean;
  /** Decorrelates independent fields that share a seed (default 0). */
  salt?: number;
};

/**
 * Deterministic 2D fractal value noise in [0, 1): smooth, irregular terrain
 * heights and masks without the banding of summed sine waves.
 */
export function fractalNoise(
  x: number,
  z: number,
  seed: number,
  options: NoiseOptions = {},
): number {
  const scale = options.scale ?? 24;
  const octaves = options.octaves ?? 4;
  if (!(scale > 0) || !Number.isInteger(octaves) || octaves < 1) {
    throw new Error(
      `noise needs scale > 0 and a positive integer octaves, got scale ${String(scale)}, octaves ${String(octaves)}`,
    );
  }
  let total = 0;
  let amplitude = 1;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const size = scale / 2 ** octave;
    let value = valueNoise(
      [x, octave * 101 + (options.salt ?? 0) * 7919, z],
      Math.max(size, 1),
      seed,
    );
    if (options.ridged === true) {
      value = 1 - Math.abs(2 * value - 1);
    }
    total += value * amplitude;
    weight += amplitude;
    amplitude /= 2;
  }
  return Math.min(total / weight, 1 - 1e-9);
}

export type Weighted = readonly (readonly [state: string, weight: number])[];

function pick(entries: Weighted, t: number): string {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = t * total;
  for (const [state, weight] of entries) {
    cursor -= weight;
    if (cursor < 0) {
      return state;
    }
  }
  const last = entries.at(-1);
  if (last === undefined) {
    throw new RangeError("palette needs at least one entry");
  }
  return last[0];
}

export type WoodFamily = {
  kind: "wood";
  planks: string;
  log: string;
  strippedLog: string;
  wood: string;
  stairs: string;
  slab: string;
  fence: string;
  fenceGate: string;
  door: string;
  trapdoor: string;
  button: string;
  pressurePlate: string;
};

export type StoneFamily = {
  kind: "stone";
  block: string;
  stairs: string | null;
  slab: string | null;
  wall: string | null;
};

export type Family = WoodFamily | StoneFamily;

export type Theme = {
  foundation: Material;
  frame: string;
  infill: Material;
  roof: string;
  roofSlab: string;
  trim: string;
  floor: string;
  glass: string;
  door: string;
  shutter: string;
  lantern: string;
};

/** Material helpers bound to the 26.2 registry and the build seed. */
export function createMat(registry: BlockRegistry, seed: number) {
  const exists = (id: string) => registry.has(namespaced(id));

  /** A validated block state; props fill in over the block's defaults. */
  function block(id: string, props: Record<string, string> = {}): string {
    return registry.resolve(withProperties(namespaced(id), props));
  }

  /** Stairs whose tall side (the way you walk up) points toward `ascend`. */
  function stairs(
    id: string,
    options: { ascend: Dir; half?: "bottom" | "top"; shape?: string },
  ): string {
    return block(id, {
      facing: facing(options.ascend),
      half: options.half ?? "bottom",
      ...(options.shape === undefined ? {} : { shape: options.shape }),
    });
  }

  /** Sets `axis` for logs and pillars (y = vertical post, x/z = beams). */
  function axis(state: string, value: "x" | "y" | "z"): string {
    const parsed = parseBlockState(state);
    return "axis" in registry.properties(parsed.id)
      ? registry.resolve(withProperties(state, { axis: value }))
      : registry.resolve(state);
  }

  function variant(name: string, suffix: string): string | null {
    for (const stem of stoneCandidates(name)) {
      if (exists(`${stem}_${suffix}`)) {
        return namespaced(`${stem}_${suffix}`);
      }
    }
    return null;
  }

  /**
   * Wood families by species (oak, spruce, dark_oak, cherry, crimson, …) or
   * stone-like families by full block (stone_bricks, deepslate_tiles, …).
   */
  function family(name: string): Family {
    const bare = name.replace(/^minecraft:/u, "");
    if (exists(`${bare}_planks`)) {
      const stem = exists(`${bare}_log`) ? "log" : "stem";
      const wood = exists(`${bare}_wood`) ? `${bare}_wood` : `${bare}_hyphae`;
      return {
        kind: "wood",
        planks: block(`${bare}_planks`),
        log: block(`${bare}_${stem}`),
        strippedLog: block(`stripped_${bare}_${stem}`),
        wood: block(wood),
        stairs: block(`${bare}_stairs`),
        slab: block(`${bare}_slab`),
        fence: block(`${bare}_fence`),
        fenceGate: block(`${bare}_fence_gate`),
        door: block(`${bare}_door`),
        trapdoor: block(`${bare}_trapdoor`),
        button: block(`${bare}_button`),
        pressurePlate: block(`${bare}_pressure_plate`),
      };
    }
    if (!exists(bare)) {
      // Throws with suggestions.
      block(bare);
    }
    const stairsId = variant(bare, "stairs");
    const slabId = variant(bare, "slab");
    const wallId = variant(bare, "wall");
    return {
      kind: "stone",
      block: block(bare),
      stairs: stairsId === null ? null : block(stairsId),
      slab: slabId === null ? null : block(slabId),
      wall: wallId === null ? null : block(wallId),
    };
  }

  /** Weighted random mix, deterministic per cell. */
  function palette(
    entries: Weighted,
    options: { seed?: number } = {},
  ): Material {
    const resolved = entries.map(
      ([state, weight]) => [block(state), weight] as const,
    );
    const salt = options.seed ?? seed;
    return (x, y, z) => pick(resolved, hash01(x, y, z, salt));
  }

  /** Spatially coherent mix: patches of each block rather than salt-and-pepper. */
  function noise(
    entries: Weighted,
    options: { scale?: number; seed?: number } = {},
  ): Material {
    const resolved = entries.map(
      ([state, weight]) => [block(state), weight] as const,
    );
    const scale = options.scale ?? 3;
    const salt = options.seed ?? seed;
    return (x, y, z) => pick(resolved, valueNoise([x, y, z], scale, salt));
  }

  /** Blocks blended along an axis from `from` to `to`, with optional jitter. */
  function gradient(
    states: readonly string[],
    options: {
      axis?: "x" | "y" | "z";
      from: number;
      to: number;
      jitter?: number;
    },
  ): Material {
    const resolved = states.map((state) => block(state));
    if (resolved.length === 0) {
      throw new RangeError("gradient needs at least one block");
    }
    const axisName = options.axis ?? "y";
    const jitter = options.jitter ?? 0.15;
    return (x, y, z) => {
      const value = axisName === "x" ? x : axisName === "y" ? y : z;
      const span = Math.max(1, options.to - options.from);
      const t =
        Math.min(1, Math.max(0, (value - options.from) / span)) +
        (hash01(x, y, z, seed) - 0.5) * 2 * jitter;
      const index = Math.min(
        resolved.length - 1,
        Math.max(0, Math.floor(t * resolved.length)),
      );
      return resolved[index] ?? resolved[0] ?? "minecraft:stone";
    };
  }

  const THEMES: Record<string, () => Theme> = {
    medieval: () => ({
      foundation: noise([
        ["cobblestone", 5],
        ["stone_bricks", 3],
        ["andesite", 2],
        ["mossy_cobblestone", 1],
      ]),
      frame: block("stripped_spruce_log"),
      infill: palette([
        ["white_terracotta", 6],
        ["calcite", 3],
        ["smooth_sandstone", 1],
      ]),
      roof: block("dark_oak_stairs"),
      roofSlab: block("dark_oak_slab"),
      trim: block("spruce_planks"),
      floor: block("spruce_planks"),
      glass: block("glass_pane"),
      door: block("spruce_door"),
      shutter: block("spruce_trapdoor"),
      lantern: block("lantern"),
    }),
    nordic: () => ({
      foundation: noise([
        ["cobblestone", 4],
        ["mossy_cobblestone", 2],
        ["stone", 2],
      ]),
      frame: block("dark_oak_log"),
      infill: block("spruce_planks"),
      roof: block("deepslate_tile_stairs"),
      roofSlab: block("deepslate_tile_slab"),
      trim: block("dark_oak_planks"),
      floor: block("spruce_planks"),
      glass: block("glass_pane"),
      door: block("dark_oak_door"),
      shutter: block("dark_oak_trapdoor"),
      lantern: block("lantern"),
    }),
    desert: () => ({
      foundation: noise([
        ["sandstone", 4],
        ["smooth_sandstone", 3],
        ["cut_sandstone", 2],
      ]),
      frame: block("stripped_acacia_log"),
      infill: palette([
        ["smooth_sandstone", 5],
        ["sandstone", 2],
      ]),
      // Roofs and sills take stairs; there are no cut_sandstone_stairs.
      roof: block("smooth_sandstone_stairs"),
      roofSlab: block("cut_sandstone_slab"),
      trim: block("acacia_planks"),
      floor: block("acacia_planks"),
      glass: block("glass_pane"),
      door: block("acacia_door"),
      shutter: block("acacia_trapdoor"),
      lantern: block("lantern"),
    }),
  };

  function theme(name: "medieval" | "nordic" | "desert"): Theme {
    const make = THEMES[name];
    if (make === undefined) {
      throw new RangeError(`Unknown theme ${name}`);
    }
    return make();
  }

  return {
    block,
    facing,
    stairs,
    axis,
    family,
    palette,
    noise,
    gradient,
    theme,
  };
}

export type Mat = ReturnType<typeof createMat>;
