import { hash01, valueNoise } from "#src/dsl/mat.ts";
import { KEEP, type Box, type Material, type Vec3 } from "#src/dsl/types.ts";
import type { CraftKit, Footprint } from "./kit.ts";

export type InteriorItem = "bed" | "table" | "bookshelves" | "lights";

export type InteriorSpec = {
  /** The room's floor area; `y` is the first free y above the floor. */
  room: Box;
  /** Wood species for the table and chairs (default spruce). */
  wood?: string;
  /** Bed color (default red). */
  bed?: string;
  /** What to place (default all of them). */
  items?: readonly InteriorItem[];
  /** Light block for `lights` (default lantern). */
  light?: string;
};

export type LandscapeSpec = {
  area: Footprint;
  /** First free y above the ground (ignored where a captured site has terrain). */
  y: number;
  /** Fill the ground layer (y - 1) first, e.g. grass_block. Needed without a site. */
  ground?: Material;
  /** Fraction of free cells that get a plant (default 0.12). */
  density?: number;
  flowers?: readonly string[];
  /** Persistent leaf bushes among the flowers (default true). */
  bushes?: boolean;
  /** Footprints to keep clear (buildings, paths). */
  avoid?: readonly Footprint[];
  seed?: number;
};

export type PathSpec = {
  from: { x: number; z: number };
  to: { x: number; z: number };
  /** First free y above the ground; the path replaces the ground layer below it. */
  y: number;
  width?: 1 | 2 | 3;
  material?: Material;
};

const DEFAULT_FLOWERS = [
  "poppy",
  "dandelion",
  "cornflower",
  "oxeye_daisy",
  "azure_bluet",
  "allium",
];

const ALL_ITEMS: readonly InteriorItem[] = [
  "bed",
  "table",
  "bookshelves",
  "lights",
];

function inside(p: { x: number; z: number }, fp: Footprint): boolean {
  return p.x >= fp.x && p.x < fp.x + fp.w && p.z >= fp.z && p.z < fp.z + fp.d;
}

/** Cells from `from` to `to` inclusive, one axis at a time (x first). */
function lPath(
  from: { x: number; z: number },
  to: { x: number; z: number },
): { x: number; z: number }[] {
  const cells: { x: number; z: number }[] = [];
  const stepX = Math.sign(to.x - from.x);
  const stepZ = Math.sign(to.z - from.z);
  for (let i = 0; i <= Math.abs(to.x - from.x); i += 1) {
    cells.push({ x: from.x + i * stepX, z: from.z });
  }
  for (let i = 1; i <= Math.abs(to.z - from.z); i += 1) {
    cells.push({ x: to.x, z: from.z + i * stepZ });
  }
  return cells;
}

export function furnishParts(kit: CraftKit) {
  const { canvas, mat, site, put } = kit;
  const free = (p: Vec3) => canvas.get(p.x, p.y, p.z) === KEEP;

  function bed(room: Box, color: string): Vec3[] {
    if (room.d < 3) {
      return [];
    }
    const head = { x: room.x, y: room.y, z: room.z };
    put(head, mat.block(`${color}_bed`, { facing: "north", part: "head" }));
    put(
      { ...head, z: room.z + 1 },
      mat.block(`${color}_bed`, { facing: "north", part: "foot" }),
    );
    return [head];
  }

  function bookshelves(room: Box): Vec3[] {
    const placed: Vec3[] = [];
    if (room.w < 3) {
      return placed;
    }
    const x = room.x + room.w - 1;
    for (let z = room.z; z < room.z + Math.min(3, room.d); z += 1) {
      for (let v = 0; v < Math.min(2, room.h - 1); v += 1) {
        const p = { x, y: room.y + v, z };
        if (free(p)) {
          put(p, mat.block("bookshelf"));
          placed.push(p);
        }
      }
    }
    return placed;
  }

  function table(room: Box, wood: string): Vec3[] {
    if (room.w < 5 || room.d < 3) {
      return [];
    }
    const top = {
      x: room.x + Math.floor(room.w / 2),
      y: room.y,
      z: room.z + Math.floor(room.d / 2),
    };
    put(top, mat.block(`${wood}_slab`, { type: "top" }));
    const placed = [top];
    for (const [dx, ascend] of [
      [-1, "left"],
      [1, "right"],
    ] as const) {
      const chair = { ...top, x: top.x + dx };
      if (free(chair)) {
        put(chair, mat.stairs(`${wood}_stairs`, { ascend }));
        placed.push(chair);
      }
    }
    return placed;
  }

  function lights(room: Box, light: string): Vec3[] {
    const placed: Vec3[] = [];
    const block = mat.block(light);
    for (let x = room.x + 1; x < room.x + room.w; x += 5) {
      for (let z = room.z + 1; z < room.z + room.d; z += 5) {
        const spot = [
          { x, y: room.y, z },
          { x, y: room.y, z: z + 1 },
        ].find((p) => p.z < room.z + room.d && free(p));
        if (spot !== undefined) {
          put(spot, block);
          placed.push(spot);
        }
      }
    }
    return placed;
  }

  /**
   * Furniture for a room: a bed in the back-left corner, bookshelves on the
   * right wall, a slab table with two chairs in the middle, and floor lights
   * on a five-block grid so the room stays above the dark-interior lint.
   */
  function interior(spec: InteriorSpec) {
    const items = new Set(spec.items ?? ALL_ITEMS);
    const { room } = spec;
    return {
      bed: items.has("bed") ? bed(room, spec.bed ?? "red") : [],
      bookshelves: items.has("bookshelves") ? bookshelves(room) : [],
      table: items.has("table") ? table(room, spec.wood ?? "spruce") : [],
      lights: items.has("lights") ? lights(room, spec.light ?? "lantern") : [],
    };
  }

  function groundY(x: number, z: number, fallback: number): number {
    return site?.heightAt(x, z) ?? fallback;
  }

  /** The plant for a cell, or null when the noise leaves it bare. */
  function plantFor(
    x: number,
    z: number,
    spec: LandscapeSpec,
    flowers: readonly string[],
  ): string | null {
    const seed = spec.seed ?? 7;
    const clump = valueNoise([x, 0, z], 4, seed);
    if (hash01(x, 0, z, seed) >= (spec.density ?? 0.12) * (0.4 + clump * 1.2)) {
      return null;
    }
    const roll = hash01(x, 1, z, seed);
    return spec.bushes !== false && roll < 0.25
      ? mat.block("oak_leaves", { persistent: "true" })
      : (flowers[Math.floor(roll * flowers.length)] ?? null);
  }

  /** Ground and maybe a plant for one cell; true when a plant was placed. */
  function landscapeCell(
    x: number,
    z: number,
    spec: LandscapeSpec,
    flowers: readonly string[],
  ): boolean {
    const p = { x, y: groundY(x, z, spec.y), z };
    if (spec.ground !== undefined && free({ ...p, y: p.y - 1 })) {
      put({ ...p, y: p.y - 1 }, spec.ground);
    }
    if ((spec.avoid ?? []).some((fp) => inside(p, fp)) || !free(p)) {
      return false;
    }
    const plant = plantFor(x, z, spec, flowers);
    if (plant !== null) {
      put(p, plant);
    }
    return plant !== null;
  }

  /**
   * Flowers and leaf bushes scattered by noise over an area, keeping clear of
   * `avoid` footprints. On a captured site plants sit on the terrain; without
   * one, give `ground` so they have something to stand on.
   */
  function landscape(spec: LandscapeSpec) {
    if (site === null && spec.ground === undefined) {
      throw new RangeError(
        "landscape needs a captured site or a `ground` material for plants to stand on",
      );
    }
    const flowers = (spec.flowers ?? DEFAULT_FLOWERS).map((id) =>
      mat.block(id),
    );
    let plants = 0;
    for (let x = spec.area.x; x < spec.area.x + spec.area.w; x += 1) {
      for (let z = spec.area.z; z < spec.area.z + spec.area.d; z += 1) {
        plants += landscapeCell(x, z, spec, flowers) ? 1 : 0;
      }
    }
    return { plants };
  }

  /**
   * A dirt path in an L from `from` to `to` (along x, then z), replacing the
   * ground layer under `y`.
   */
  function path(spec: PathSpec) {
    const width = spec.width ?? 1;
    const material =
      spec.material ??
      mat.noise([
        ["dirt_path", 5],
        ["coarse_dirt", 2],
        ["gravel", 1],
      ]);
    const cells = lPath(spec.from, spec.to);
    for (const { x, z } of cells) {
      for (let o = 0; o < width; o += 1) {
        for (const [px, pz] of [
          [x + o, z],
          [x, z + o],
        ] as const) {
          put({ x: px, y: groundY(px, pz, spec.y) - 1, z: pz }, material);
        }
      }
    }
    return { cells: cells.length };
  }

  return { interior, landscape, path };
}
