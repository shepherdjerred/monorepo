/** Building blocks of the house generator: storeys, wings, roofs, chimney. */
import type { BuildContext } from "@shepherdjerred/mc-build/dsl/context.ts";
import type {
  Dir,
  Material,
  Vec3,
} from "@shepherdjerred/mc-build/dsl/types.ts";
import type { Palette } from "./palette.ts";

export type Fp = { x: number; z: number; w: number; d: number };
export type RoofType = "gable" | "hip" | "mansard";

export const OPPOSITE: Record<Dir, Dir> = {
  front: "back",
  back: "front",
  left: "right",
  right: "left",
};

const SIDES = ["front", "back", "left", "right"] as const;

export function odd(n: number): number {
  return n % 2 === 0 ? n + 1 : n;
}

export function faceWidth(fp: Fp, dir: Dir): number {
  return dir === "front" || dir === "back" ? fp.w : fp.d;
}

/** Post positions along a face of `width`: every 4, and a door frame. */
function posts(width: number, door: number | null): number[] {
  const out = new Set<number>();
  for (let u = 0; u < width; u += 4) {
    out.add(u);
  }
  if (door !== null) {
    for (const u of out) {
      if (Math.abs(u - door) <= 1) {
        out.delete(u);
      }
    }
    out.add(door - 1);
    out.add(door + 1);
  }
  return [...out]
    .filter((u) => u > 0 && u < width - 1)
    .toSorted((a, b) => a - b);
}

/** Window centres between posts, skipping the door bay. */
function windowSlots(
  width: number,
  postList: readonly number[],
  door: number | null,
): number[] {
  const edges = [0, ...postList, width - 1];
  const slots: number[] = [];
  for (let i = 1; i < edges.length; i += 1) {
    const lo = (edges[i - 1] ?? 0) + 1;
    const hi = (edges[i] ?? 0) - 1;
    const mid = Math.floor((lo + hi) / 2);
    const doorBay = door !== null && Math.abs(mid - door) <= 1;
    if (!doorBay && hi >= lo) {
      slots.push(mid);
    }
  }
  return slots;
}

export type Storey = {
  fp: Fp;
  y: number;
  h: number;
  door: number | null;
  facing: Dir;
  infill: Material;
  /** Which alternate bays get windows (0 or 1): plain panels between. */
  rhythm: number;
  shutters: boolean;
};

export type StoreyWalls = ReturnType<BuildContext["craft"]["walls"]>;

/** Timber walls with framed bays, windows in alternate bays and a lantern. */
export function storeyWalls(
  ctx: BuildContext,
  p: Palette,
  s: Storey,
): StoreyWalls {
  const postsAt: Partial<Record<Dir, number[]>> = {};
  for (const dir of SIDES) {
    postsAt[dir] = posts(
      faceWidth(s.fp, dir),
      dir === s.facing ? s.door : null,
    );
  }
  const walls = ctx.craft.walls({
    ...s.fp,
    y: s.y,
    h: s.h,
    frame: p.frame,
    infill: s.infill,
    postsAt,
  });
  const shutters =
    s.shutters && p.shutter !== null ? { shutters: p.shutter } : {};
  for (const dir of SIDES) {
    const slots = windowSlots(
      faceWidth(s.fp, dir),
      postsAt[dir] ?? [],
      dir === s.facing ? s.door : null,
    );
    // Negative space: windows in alternate bays (at least one per face).
    const chosen = slots.filter((_, i) => (i + s.rhythm) % 2 === 0);
    for (const at of chosen.length > 0 ? chosen : slots.slice(0, 1)) {
      ctx.craft.window(walls.faces[dir], {
        at,
        w: 1,
        h: 2,
        sill: p.roof,
        ...shutters,
      });
    }
  }
  const room = walls.interior;
  if (room.w > 0 && room.d > 0) {
    ctx.set(
      room.x + Math.floor(room.w / 2),
      s.y,
      room.z + Math.floor(room.d / 2),
      "lantern",
    );
  }
  return walls;
}

/** Footprint grown one block toward `dir` (a jetty). */
export function grow(fp: Fp, dir: Dir): Fp {
  const grown: Record<Dir, Fp> = {
    front: { ...fp, d: fp.d + 1 },
    back: { ...fp, z: fp.z - 1, d: fp.d + 1 },
    right: { ...fp, w: fp.w + 1 },
    left: { ...fp, x: fp.x - 1, w: fp.w + 1 },
  };
  return grown[dir];
}

/** A wing footprint attached (overlapping one wall) to `side` of `fp`. */
export function wingFootprint(fp: Fp, side: Dir, roll: number): Fp {
  const across = side === "left" || side === "right" ? fp.d : fp.w;
  const width = Math.max(5, odd(across - 2 - (roll < 0.5 ? 0 : 2)));
  const length = roll < 0.5 ? 5 : 7;
  const offset = roll < 0.33 ? 0 : across - width;
  const placed: Record<Dir, Fp> = {
    left: { x: fp.x - length + 1, z: fp.z + offset, w: length, d: width },
    right: { x: fp.x + fp.w - 1, z: fp.z + offset, w: length, d: width },
    back: { x: fp.x + offset, z: fp.z - length + 1, w: width, d: length },
    front: { x: fp.x + offset, z: fp.z + fp.d - 1, w: width, d: length },
  };
  return placed[side];
}

/** The roof over `fp` starting at `y`; returns the ridge's top y. */
export function roof(
  ctx: BuildContext,
  p: Palette,
  o: { fp: Fp; y: number; type: RoofType; gable: Material },
): number {
  const { fp, y } = o;
  const rise = y + Math.ceil(Math.min(fp.w, fp.d) / 2) + 1;
  if (o.type === "hip") {
    ctx.craft.hipRoof({ ...fp, y, stairs: p.roof, overhang: 1, eaves: true });
    return rise;
  }
  if (o.type === "mansard") {
    return ctx.craft.mansardRoof({ ...fp, y, wall: p.mansard, stairs: p.roof })
      .top;
  }
  ctx.craft.gableRoof({
    ...fp,
    y,
    ridge: fp.w >= fp.d ? "x" : "z",
    stairs: p.roof,
    overhang: 1,
    gable: o.gable,
    eaves: true,
  });
  return rise;
}

/** Door step: stairs climbing the plinth outside the door. */
export function step(
  ctx: BuildContext,
  door: Vec3,
  o: { facing: Dir; plinth: number; stairs: string },
): void {
  const out: Record<Dir, readonly [number, number]> = {
    front: [0, 1],
    back: [0, -1],
    left: [-1, 0],
    right: [1, 0],
  };
  const [dx, dz] = out[o.facing];
  for (let i = 1; i <= o.plinth; i += 1) {
    ctx.set(
      door.x + dx * i,
      door.y - i,
      door.z + dz * i,
      ctx.mat.stairs(o.stairs, { ascend: OPPOSITE[o.facing] }),
    );
  }
}

/** An exterior chimney on a gable end (or any side), off-centre, above the ridge. */
export function chimney(
  ctx: BuildContext,
  p: Palette,
  o: {
    fp: Fp;
    base: number;
    ridgeTop: number;
    roofType: RoofType;
    wingSide: Dir | null;
    roll: number;
  },
): number {
  const { fp } = o;
  const ends: Dir[] =
    o.roofType === "gable"
      ? fp.w >= fp.d
        ? ["left", "right"]
        : ["front", "back"]
      : ["left", "right", "back"];
  const choices = ends.filter((dir) => dir !== o.wingSide);
  const side = choices[Math.floor(o.roll * choices.length)] ?? "left";
  const along = side === "left" || side === "right" ? fp.d : fp.w;
  const offset = 1 + Math.floor(o.roll * Math.max(1, along - 3));
  const at: Record<Dir, { x: number; z: number }> = {
    left: { x: fp.x - 1, z: fp.z + offset },
    right: { x: fp.x + fp.w, z: fp.z + offset },
    back: { x: fp.x + offset, z: fp.z - 1 },
    front: { x: fp.x + offset, z: fp.z + fp.d },
  };
  const height = o.ridgeTop + 2 - o.base;
  ctx.craft.chimney({
    ...at[side],
    base: o.base,
    height,
    material: p.chimney,
    cap: "campfire",
  });
  return o.base + height + 1;
}
