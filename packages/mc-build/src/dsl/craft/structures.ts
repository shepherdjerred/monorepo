import {
  OPPOSITE,
  WORLD_FACING,
  type Dir,
  type Material,
  type Vec3,
} from "#src/dsl/types.ts";
import { slabFor, type CraftKit } from "./kit.ts";
import type { WallFace } from "./walls.ts";

export type ChimneySpec = {
  x: number;
  z: number;
  /** First y of the stack (e.g. the floor or foundation top). */
  base: number;
  height: number;
  material: Material;
  /** 1 (default) or 2 blocks square. */
  size?: 1 | 2;
  /** Placed on top of the stack, e.g. a campfire for smoke or a wall cap. */
  cap?: string;
};

export type TowerSpec = {
  /** Center column. */
  x: number;
  z: number;
  /** First y of the wall (usually a foundation top). */
  y: number;
  shape: "round" | "square";
  /** Distance from the center to the wall ring. */
  radius: number;
  /** Wall height up to and including the top platform. */
  h: number;
  wall: Material;
  /** Interior floors (and the top platform). Default: the wall material. */
  floor?: Material;
  /** Blocks between interior floors (default 5). */
  floorEvery?: number;
  /** Alternating merlons on the top ring (default true). */
  crenellations?: boolean;
  /** A two-block door in the wall on this side. */
  door?: { dir: Dir; block: string };
  /** Iron-bar arrow slits on all four sides at each floor (default true). */
  slits?: boolean;
  /** A light on every interior floor (default lantern). */
  light?: string;
};

export type PorchSpec = {
  face: WallFace;
  /** First u (along the face) the porch covers. */
  at: number;
  w: number;
  /** How far it projects from the wall (default 3). */
  depth?: number;
  floor: Material;
  /** Corner posts: a fence or log. */
  post: string;
  /** Canopy stairs (the outer edge) and slab (the rest). */
  roof: string;
  /** Fence along the open sides, leaving the middle of the front open. */
  railing?: string;
  /** Post height (default 3). */
  height?: number;
};

type Cell = { dx: number; dz: number };

function inTower(
  shape: TowerSpec["shape"],
  r: number,
  dx: number,
  dz: number,
): boolean {
  return shape === "square"
    ? Math.abs(dx) <= r && Math.abs(dz) <= r
    : dx * dx + dz * dz <= (r + 0.5) ** 2;
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** A tower's cross-section split into the wall ring and the interior. */
function towerCells(
  shape: TowerSpec["shape"],
  r: number,
): { ring: Cell[]; interior: Cell[] } {
  const ring: Cell[] = [];
  const interior: Cell[] = [];
  for (let dx = -r; dx <= r; dx += 1) {
    for (let dz = -r; dz <= r; dz += 1) {
      if (!inTower(shape, r, dx, dz)) {
        continue;
      }
      const enclosed = NEIGHBOURS.every(([ox, oz]) =>
        inTower(shape, r, dx + ox, dz + oz),
      );
      (enclosed ? interior : ring).push({ dx, dz });
    }
  }
  return { ring, interior };
}

/** Floor levels: the base, every `every` blocks, and the top platform. */
function floorLevels(base: number, top: number, every: number): number[] {
  const levels = [base - 1];
  for (let y = base - 1 + every; y < top - 1; y += every) {
    levels.push(y);
  }
  levels.push(top - 1);
  return levels;
}

/** Unit step for a build direction. */
const STEP: Record<Dir, Cell> = {
  front: { dx: 0, dz: 1 },
  back: { dx: 0, dz: -1 },
  right: { dx: 1, dz: 0 },
  left: { dx: -1, dz: 0 },
};

const SIDES = ["front", "back", "left", "right"] as const;

export function structureParts(kit: CraftKit) {
  const { canvas, mat, put } = kit;

  /**
   * A masonry stack from `base` up `height` blocks (place it after the roof so
   * it cuts through), with an optional `cap` such as a campfire for smoke.
   */
  function chimney(spec: ChimneySpec) {
    const size = spec.size ?? 1;
    canvas.fill(
      { x: spec.x, y: spec.base, z: spec.z, w: size, h: spec.height, d: size },
      spec.material,
    );
    const top = spec.base + spec.height;
    if (spec.cap !== undefined) {
      canvas.fill(
        { x: spec.x, y: top, z: spec.z, w: size, h: 1, d: size },
        mat.block(spec.cap),
      );
    }
    return { top };
  }

  function twoBlockDoor(at: Vec3, dir: Dir, block: string): void {
    const facing = WORLD_FACING[OPPOSITE[dir]];
    for (const [v, half] of [
      [0, "lower"],
      [1, "upper"],
    ] as const) {
      put(
        { ...at, y: at.y + v },
        mat.block(block, { facing, half, hinge: "left", open: "false" }),
      );
    }
  }

  /** Floor, a centered light, and arrow slits for one tower level. */
  function towerLevel(
    spec: TowerSpec,
    interior: readonly Cell[],
    y: number,
    platform: boolean,
  ): void {
    for (const { dx, dz } of interior) {
      put({ x: spec.x + dx, y, z: spec.z + dz }, spec.floor ?? spec.wall);
    }
    // A roofed tower (no crenellations) encloses its top platform too.
    if (!platform || spec.crenellations === false) {
      put(
        { x: spec.x, y: y + 1, z: spec.z },
        mat.block(spec.light ?? "lantern"),
      );
    }
    if (platform) {
      return;
    }
    if (spec.slits === false) {
      return;
    }
    for (const dir of SIDES) {
      const { dx, dz } = STEP[dir];
      put(
        {
          x: spec.x + dx * spec.radius,
          y: y + 2,
          z: spec.z + dz * spec.radius,
        },
        mat.block("iron_bars"),
      );
    }
  }

  /**
   * A round or square tower: a hollow wall ring with interior floors, a
   * walkable top platform, optional crenellations, a door, arrow slits and a
   * light per floor. Finish a round tower with `conicalRoof` at `top` (turn
   * crenellations off) or leave it battlemented.
   */
  function tower(spec: TowerSpec) {
    const { ring, interior } = towerCells(spec.shape, spec.radius);
    const top = spec.y + spec.h;
    for (const { dx, dz } of ring) {
      canvas.fill(
        { x: spec.x + dx, y: spec.y, z: spec.z + dz, w: 1, h: spec.h, d: 1 },
        spec.wall,
      );
    }
    for (const y of floorLevels(spec.y, top, spec.floorEvery ?? 5)) {
      towerLevel(spec, interior, y, y === top - 1);
    }
    if (spec.crenellations !== false) {
      for (const { dx, dz } of ring) {
        if ((dx + dz + spec.radius) % 2 === 0) {
          put({ x: spec.x + dx, y: top, z: spec.z + dz }, spec.wall);
        }
      }
    }
    if (spec.door !== undefined) {
      const { dx, dz } = STEP[spec.door.dir];
      twoBlockDoor(
        {
          x: spec.x + dx * spec.radius,
          y: spec.y,
          z: spec.z + dz * spec.radius,
        },
        spec.door.dir,
        spec.door.block,
      );
    }
    return { top, center: { x: spec.x, z: spec.z } };
  }

  function porchRailing(spec: PorchSpec, depth: number, last: number): void {
    if (spec.railing === undefined) {
      return;
    }
    const fence = mat.block(spec.railing);
    const middle = Math.floor((spec.at + last) / 2);
    for (let u = spec.at + 1; u < last; u += 1) {
      if (u !== middle) {
        put(spec.face.cell(u, 0, -depth), fence);
      }
    }
    for (const u of [spec.at, last]) {
      for (let layer = -1; layer > -depth; layer -= 1) {
        put(spec.face.cell(u, 0, layer), fence);
      }
    }
  }

  /**
   * A covered porch against a wall face: a deck at foundation level, posts at
   * the outer corners, a canopy (stairs on the outer edge, top slabs behind)
   * and an optional railing with the middle of the front left open.
   */
  function porch(spec: PorchSpec) {
    const depth = spec.depth ?? 3;
    const height = spec.height ?? 3;
    const { face } = spec;
    const last = spec.at + spec.w - 1;
    const slab = mat.block(slabFor(spec.roof), { type: "top" });
    const edge = mat.stairs(spec.roof, { ascend: OPPOSITE[face.dir] });
    for (let layer = -1; layer >= -depth; layer -= 1) {
      for (let u = spec.at; u <= last; u += 1) {
        put(face.cell(u, -1, layer), spec.floor);
      }
      for (let u = spec.at - 1; u <= last + 1; u += 1) {
        put(face.cell(u, height, layer), layer === -depth ? edge : slab);
      }
    }
    for (const u of [spec.at, last]) {
      for (let v = 0; v < height; v += 1) {
        put(face.cell(u, v, -depth), mat.block(spec.post));
      }
    }
    porchRailing(spec, depth, last);
    return { entrance: Math.floor((spec.at + last) / 2) };
  }

  return { chimney, tower, porch };
}
