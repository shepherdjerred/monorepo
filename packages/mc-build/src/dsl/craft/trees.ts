import { hash01 } from "#src/dsl/mat.ts";
import { AIR, KEEP, type Vec3 } from "#src/dsl/types.ts";
import type { CraftKit } from "./kit.ts";

export type TreeSpecies =
  | "oak"
  | "birch"
  | "spruce"
  | "dark_oak"
  | "cherry"
  | "acacia"
  | "jungle"
  | "pale_oak"
  | "mangrove";

export type TreeSize = "small" | "medium" | "large";

export type TreeSpec = {
  /** Trunk base: the first free cell above the ground. */
  x: number;
  y: number;
  z: number;
  species?: TreeSpecies;
  size?: TreeSize;
  /** Trunk height (defaults by species and size). */
  height?: number;
  /** Variant seed; change it for a different tree at the same spot. */
  seed?: number;
};

/** Leaf mix per species: [leaf block, weight] (~75/20/5 base, second, accent). */
const LEAF_MIX: Record<TreeSpecies, readonly (readonly [string, number])[]> = {
  oak: [
    ["oak_leaves", 75],
    ["azalea_leaves", 20],
    ["flowering_azalea_leaves", 5],
  ],
  birch: [
    ["birch_leaves", 80],
    ["oak_leaves", 20],
  ],
  spruce: [["spruce_leaves", 100]],
  dark_oak: [
    ["dark_oak_leaves", 80],
    ["oak_leaves", 15],
    ["azalea_leaves", 5],
  ],
  cherry: [
    ["cherry_leaves", 85],
    ["flowering_azalea_leaves", 15],
  ],
  acacia: [
    ["acacia_leaves", 90],
    ["jungle_leaves", 10],
  ],
  jungle: [
    ["jungle_leaves", 80],
    ["oak_leaves", 20],
  ],
  pale_oak: [["pale_oak_leaves", 100]],
  mangrove: [
    ["mangrove_leaves", 85],
    ["azalea_leaves", 15],
  ],
};

const SIZES: Record<
  TreeSize,
  { height: number; branches: number; reach: number; crown: number }
> = {
  small: { height: 5, branches: 2, reach: 2, crown: 2 },
  medium: { height: 7, branches: 4, reach: 3, crown: 2.6 },
  large: { height: 11, branches: 6, reach: 5, crown: 3.4 },
};

type Grower = {
  kit: CraftKit;
  spec: Required<Omit<TreeSpec, "height">> & { height: number };
  wood: string;
  /** Deterministic [0, 1) for draw `i` of this tree. */
  draw: (i: number) => number;
  leafAt: (p: Vec3) => string;
  /** Places `material` unless the cell is taken, tracking the highest cell. */
  place: (p: Vec3, material: string) => void;
};

function placeIfFree(kit: CraftKit, p: Vec3, material: string): boolean {
  const current = kit.canvas.get(p.x, p.y, p.z);
  if (current !== KEEP && current !== AIR) {
    return false;
  }
  kit.put(p, material);
  return true;
}

/** A kinked trunk (2×2 at the base of large trees); returns its top cell. */
function trunk(g: Grower): Vec3 {
  const { x, y, z, height, size } = g.spec;
  const kinkAt = 3 + Math.floor(g.draw(1) * 2);
  const angle = g.draw(2) * Math.PI * 2;
  const kink = {
    x: Math.round(Math.cos(angle)),
    z: Math.round(Math.sin(angle)),
  };
  const thick = size === "large" ? Math.floor(height / 2) : 0;
  let top = { x, y, z };
  for (let h = 0; h < height; h += 1) {
    const offset = size !== "small" && h >= kinkAt ? kink : { x: 0, z: 0 };
    const cell = { x: x + offset.x, y: y + h, z: z + offset.z };
    g.place(cell, g.wood);
    if (h === kinkAt) {
      g.place({ x, y: y + h, z }, g.wood);
    }
    if (h < thick) {
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        g.place({ x: cell.x + dx, y: cell.y, z: cell.z + dz }, g.wood);
      }
    }
    top = cell;
  }
  if (size === "large") {
    roots(g);
  }
  return top;
}

/** Flared roots climbing 1–2 up the base of a large trunk. */
function roots(g: Grower): void {
  const { x, y, z } = g.spec;
  const sides = [
    [-1, 0],
    [2, 0],
    [0, -1],
    [1, 2],
  ] as const;
  sides.forEach(([dx, dz], i) => {
    const tall = g.draw(10 + i) < 0.5 ? 1 : 2;
    for (let h = 0; h < tall; h += 1) {
      g.place({ x: x + dx, y: y + h, z: z + dz }, g.wood);
    }
  });
}

/** Branches rising outward from the upper trunk; returns their tip cells. */
function branches(g: Grower, top: Vec3): Vec3[] {
  const shape = SIZES[g.spec.size];
  const count = Math.max(1, shape.branches - (g.draw(20) < 0.5 ? 1 : 0));
  const tips: Vec3[] = [];
  for (let i = 0; i < count; i += 1) {
    const startY = top.y - Math.floor(g.spec.height * (0.45 * g.draw(30 + i)));
    const angle = Math.PI * 2 * ((i + g.draw(40 + i) * 0.6) / count);
    const reach = shape.reach + Math.floor(g.draw(50 + i) * 2);
    const flat = g.spec.species === "acacia";
    let tip = { x: top.x, y: startY, z: top.z };
    for (let s = 1; s <= reach; s += 1) {
      tip = {
        x: top.x + Math.round(Math.cos(angle) * s),
        y: startY + Math.floor(s / (flat ? 3 : 2)),
        z: top.z + Math.round(Math.sin(angle) * s),
      };
      g.place(tip, g.wood);
    }
    tips.push(tip);
  }
  return tips;
}

/** Whether a canopy cell holds a leaf: inside a jittered dome, edges wispy. */
function inCanopy(
  g: Grower,
  p: Vec3,
  offset: Vec3,
  shape: { radius: number; up: number; down: number },
): boolean {
  const vertical = offset.y < 0 ? offset.y / shape.down : offset.y / shape.up;
  const d =
    (offset.x / shape.radius) ** 2 +
    (offset.z / shape.radius) ** 2 +
    vertical ** 2;
  const jitter = hash01(p.x, p.y, p.z, g.spec.seed + 71);
  if (d > 1 + (jitter - 0.5) * 0.45) {
    return false;
  }
  const diagonal = offset.x !== 0 && offset.z !== 0;
  return !(diagonal && jitter < 0.4 && d > 0.62);
}

/** A domed leaf mass: flatter underneath, wispy diagonal-only edges. */
function canopy(
  g: Grower,
  centre: Vec3,
  radius: number,
  flatten: number,
): void {
  const r = Math.ceil(radius);
  const shape = { radius, up: radius * flatten, down: radius * flatten * 0.6 };
  for (let dx = -r; dx <= r; dx += 1) {
    for (let dz = -r; dz <= r; dz += 1) {
      for (
        let dy = -Math.ceil(shape.down);
        dy <= Math.ceil(shape.up);
        dy += 1
      ) {
        const p = { x: centre.x + dx, y: centre.y + dy, z: centre.z + dz };
        if (inCanopy(g, p, { x: dx, y: dy, z: dz }, shape)) {
          g.place(p, g.leafAt(p));
        }
      }
    }
  }
}

/** One jagged leaf ring of a conifer at height `y`. */
function coniferRing(g: Grower, y: number, radius: number): void {
  const { x, z } = g.spec;
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      const p = { x: x + dx, y, z: z + dz };
      const edge = dx * dx + dz * dz;
      const roll = hash01(p.x, p.y, p.z, g.spec.seed);
      const centre = dx === 0 && dz === 0;
      const ragged = !centre && edge >= radius * radius - 1 && roll < 0.3;
      if (!ragged && edge <= radius * radius + 0.5) {
        g.place(p, g.leafAt(p));
      }
    }
  }
}

/** Ring radius at height `h`: a cone with alternating jags, closed at the tip. */
function coniferRadius(height: number, h: number): number {
  if (h > height) {
    return 0;
  }
  const radius = Math.max(1, Math.floor((height + 1 - h) * 0.45));
  return radius >= 2 && h % 2 === 0 ? radius - 1 : radius;
}

/** Spruce: jagged conical layers of leaves around a straight trunk. */
function conifer(g: Grower): void {
  const { x, y, z, height } = g.spec;
  for (let h = 0; h < height; h += 1) {
    g.place({ x, y: y + h, z }, g.wood);
  }
  for (let h = Math.max(2, Math.floor(height / 4)); h <= height + 1; h += 1) {
    coniferRing(g, y + h, coniferRadius(height, h));
  }
}

export function treeParts(kit: CraftKit) {
  return {
    /**
     * A natural tree: kinked trunk of six-sided wood, branches first, domed
     * mixed-leaf canopies at the branch tips (spruce: jagged cone; acacia:
     * flat crowns). Leaves are persistent. Vary species, size and seed so
     * no two trees match → `{ top }`, the first free y above the highest
     * block it placed.
     */
    tree(spec: TreeSpec): { top: number } {
      const species = spec.species ?? "oak";
      const size = spec.size ?? "medium";
      const seed = spec.seed ?? 1;
      const height =
        spec.height ?? SIZES[size].height + (species === "spruce" ? 3 : 0);
      if (!Number.isInteger(height) || height < 3) {
        throw new Error(
          `tree height must be an integer ≥ 3, got ${String(height)}`,
        );
      }
      const mix = LEAF_MIX[species];
      const total = mix.reduce((sum, [, weight]) => sum + weight, 0);
      const leaves = mix.map(([id, weight]) => ({
        state: kit.mat.block(id, { persistent: "true" }),
        weight: weight / total,
      }));
      let highest = spec.y - 1;
      const g: Grower = {
        kit,
        spec: { ...spec, species, size, seed, height },
        wood: kit.mat.block(`${species}_wood`),
        draw: (i) => hash01(spec.x * 31 + i, spec.y, spec.z * 17 - i, seed),
        leafAt: (p) => {
          let roll = hash01(p.x, p.y, p.z, seed + 13);
          for (const leaf of leaves) {
            roll -= leaf.weight;
            if (roll < 0) {
              return leaf.state;
            }
          }
          return leaves[0]?.state ?? kit.mat.block(`${species}_leaves`);
        },
        place: (p, material) => {
          if (placeIfFree(kit, p, material)) {
            highest = Math.max(highest, p.y);
          }
        },
      };
      if (species === "spruce") {
        conifer(g);
        return { top: highest + 1 };
      }
      const top = trunk(g);
      const tips = branches(g, top);
      const crown = SIZES[size].crown;
      const flatten = species === "acacia" ? 0.4 : 0.85;
      for (const tip of tips) {
        canopy(g, { ...tip, y: tip.y + 1 }, crown, flatten);
      }
      canopy(g, { ...top, y: top.y + 1 }, crown + 0.6, flatten);
      return { top: highest + 1 };
    },
  };
}
