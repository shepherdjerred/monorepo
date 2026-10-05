/**
 * Natural rocks: lumpy boulders and tall outcrops built from a few
 * overlapping, jittered ellipsoids (never one sphere), sunk into the ground,
 * with small satellite stones around big ones.
 */
import type { BuildContext } from "@shepherdjerred/mc-build/dsl/context.ts";
import type { Material } from "@shepherdjerred/mc-build/dsl/types.ts";

export type RockPalette = "stone" | "mossy" | "granite" | "sandstone" | "dark";

const PALETTES: Record<RockPalette, readonly (readonly [string, number])[]> = {
  stone: [
    ["stone", 55],
    ["andesite", 25],
    ["cobblestone", 12],
    ["tuff", 8],
  ],
  mossy: [
    ["stone", 40],
    ["mossy_cobblestone", 25],
    ["andesite", 20],
    ["cobblestone", 15],
  ],
  granite: [
    ["granite", 50],
    ["polished_granite", 10],
    ["terracotta", 20],
    ["andesite", 20],
  ],
  sandstone: [
    ["sandstone", 50],
    ["smooth_sandstone", 25],
    ["terracotta", 15],
    ["granite", 10],
  ],
  dark: [
    ["deepslate", 45],
    ["cobbled_deepslate", 25],
    ["tuff", 20],
    ["blackstone", 10],
  ],
};

export type BoulderSpec = {
  /** Ground surface: the boulder sits on (x, y - 1, z) and sinks into it. */
  x: number;
  y: number;
  z: number;
  /** Rough radius in blocks, 1–6 (default 2). */
  size?: number;
  /** "lump" (wide, low) or "tall" (narrow outcrop); default lump. */
  shape?: "lump" | "tall";
  palette?: RockPalette;
  /** Small stones around it (default true for size ≥ 2). */
  satellites?: boolean;
  /** Variant; change it for a different rock at the same spot. */
  seed?: number;
};

function roll(ctx: BuildContext, x: number, z: number, salt: number): number {
  return ctx.noise(x, z, { scale: 1, octaves: 1, salt });
}

/** One jittered ellipsoid lobe of a rock. */
function lobe(
  ctx: BuildContext,
  centre: { x: number; y: number; z: number },
  radii: { x: number; y: number; z: number },
  paint: { material: Material; salt: number },
): void {
  const { material, salt } = paint;
  const rx = Math.ceil(radii.x);
  const ry = Math.ceil(radii.y);
  const rz = Math.ceil(radii.z);
  for (let dx = -rx; dx <= rx; dx += 1) {
    for (let dy = -ry; dy <= ry; dy += 1) {
      for (let dz = -rz; dz <= rz; dz += 1) {
        const d =
          (dx / radii.x) ** 2 + (dy / radii.y) ** 2 + (dz / radii.z) ** 2;
        const x = centre.x + dx;
        const y = centre.y + dy;
        const z = centre.z + dz;
        const jitter = (roll(ctx, x * 7 + y, z, salt) - 0.5) * 0.5;
        if (d <= 1 + jitter) {
          ctx.set(x, y, z, material);
        }
      }
    }
  }
}

/** A lumpy boulder or outcrop of 2–4 lobes, sunk 1–2 blocks into the ground. */
export function boulder(ctx: BuildContext, spec: BoulderSpec): void {
  const size = Math.min(6, Math.max(1, spec.size ?? 2));
  const tall = spec.shape === "tall";
  const salt = 100 + (spec.seed ?? 0) * 13;
  const material = ctx.mat.noise(PALETTES[spec.palette ?? "stone"], {
    scale: 2,
  });
  const sink = size >= 3 ? 2 : 1;
  const lobes =
    size <= 1 ? 1 : 2 + Math.floor(roll(ctx, spec.x, spec.z, salt) * 3);
  for (let i = 0; i < lobes; i += 1) {
    const a = roll(ctx, spec.x + i, spec.z - i, salt + 1) * Math.PI * 2;
    const spread = i === 0 ? 0 : size * 0.6;
    const scale =
      i === 0 ? 1 : 0.55 + roll(ctx, spec.x, spec.z + i, salt + 2) * 0.35;
    const r = size * scale;
    const height = tall
      ? r * (1.6 + roll(ctx, i, spec.z, salt + 3) * 0.8)
      : r * 0.7;
    lobe(
      ctx,
      {
        x: spec.x + Math.round(Math.cos(a) * spread),
        y: spec.y - sink + Math.round(height * 0.6),
        z: spec.z + Math.round(Math.sin(a) * spread),
      },
      { x: tall ? r * 0.7 : r, y: height, z: tall ? r * 0.7 : r * 0.85 },
      { material, salt: salt + i },
    );
  }
  if (spec.satellites ?? size >= 2) {
    satellites(ctx, spec, { size, material, salt });
  }
}

function satellites(
  ctx: BuildContext,
  spec: BoulderSpec,
  o: { size: number; material: Material; salt: number },
): void {
  const { size, material, salt } = o;
  const count = 1 + Math.floor(roll(ctx, spec.z, spec.x, salt + 9) * 3);
  for (let i = 0; i < count; i += 1) {
    const a = roll(ctx, spec.x - i, spec.z + i, salt + 10) * Math.PI * 2;
    const distance = size + 1 + Math.floor(roll(ctx, i, spec.x, salt + 11) * 2);
    const x = spec.x + Math.round(Math.cos(a) * distance);
    const z = spec.z + Math.round(Math.sin(a) * distance);
    ctx.set(x, spec.y, z, material);
    if (roll(ctx, x, z, salt + 12) < 0.4) {
      ctx.set(x + 1, spec.y, z, material);
    }
  }
}

/**
 * Scatters boulders over an area: `ground(x, z)` gives the surface y (e.g.
 * a terrain heightfield's `at`), `skip(x, z)` rejects occupied cells.
 */
export function scatterRocks(
  ctx: BuildContext,
  spec: {
    x: number;
    z: number;
    w: number;
    d: number;
    ground: (x: number, z: number) => number | null;
    /** Boulders per 100 cells (default 0.6). */
    density?: number;
    maxSize?: number;
    palette?: RockPalette;
    skip?: (x: number, z: number) => boolean;
  },
): { placed: number } {
  const density = (spec.density ?? 0.6) / 100;
  let placed = 0;
  for (let x = spec.x; x < spec.x + spec.w; x += 1) {
    for (let z = spec.z; z < spec.z + spec.d; z += 1) {
      if (roll(ctx, x, z, 91) >= density || spec.skip?.(x, z) === true) {
        continue;
      }
      const ground = spec.ground(x, z);
      if (ground === null) {
        continue;
      }
      const size = 1 + Math.floor(roll(ctx, z, x, 92) * (spec.maxSize ?? 3));
      boulder(ctx, {
        x,
        y: ground + 1,
        z,
        size,
        shape: roll(ctx, x, z, 93) < 0.25 ? "tall" : "lump",
        palette: spec.palette ?? "stone",
        seed: x * 31 + z,
      });
      placed += 1;
    }
  }
  return { placed };
}
