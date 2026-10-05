/**
 * A varied house generator on the craft primitives: plinth, recessed timber
 * walls, a framed door with a step, the window kit, a jettied upper storey,
 * an L/T wing with a lower roof, gable/hip/mansard roofs with overhang and
 * eaves, an off-centre chimney and an optional porch. The seed drives
 * massing, storeys, roof, wing, jetty, porch and palette variant, so a
 * street of seeds never repeats a house.
 */
import type { BuildContext } from "@shepherdjerred/mc-build/dsl/context.ts";
import type { Dir, Vec3 } from "@shepherdjerred/mc-build/dsl/types.ts";
import {
  housePalette,
  isTimber,
  type HouseStyle,
  type Palette,
} from "./palette.ts";
import {
  chimney,
  faceWidth,
  grow,
  odd,
  OPPOSITE,
  roof,
  step,
  storeyWalls,
  wingFootprint,
  type Fp,
  type RoofType,
  type StoreyWalls,
} from "./parts.ts";

export type HouseSpec = {
  /** Main volume's min corner (x, z) and the first free y above the ground. */
  x: number;
  z: number;
  y: number;
  /** Main footprint; odd sizes give a single ridge and a centred door. */
  w?: number;
  d?: number;
  storeys?: 1 | 2 | 3;
  roof?: RoofType;
  /** medieval | tudor | rustic | nordic | desert | stone (default medieval). */
  style?: HouseStyle;
  /** The side the door faces (default "front", i.e. +z / south). */
  facing?: Dir;
  /** A lower wing: a side, "none", or "auto" (seeded). */
  wing?: Dir | "none" | "auto";
  /** Upper storeys project one block over the door side (seeded by default). */
  jetty?: boolean;
  porch?: boolean;
  chimney?: boolean;
  /** Lowest ground y under the house; the foundation reaches it (default y - 1). */
  base?: number;
  /** Rows of stone plinth above the ground (default 1). */
  plinth?: number;
  seed?: number;
};

export type House = {
  /** Highest y the roof or chimney reaches. */
  top: number;
  /** The door's lower block. */
  door: Vec3;
  /** Every volume's footprint (main first), for keeping plots clear. */
  footprints: Fp[];
};

type Plan = {
  fp: Fp;
  facing: Dir;
  storeys: number;
  roofType: RoofType;
  style: HouseStyle;
  p: Palette;
  plinth: number;
  base: number;
  floorY: number;
  jetty: boolean;
  wing: Dir | null;
  doorAt: number;
  roll: (i: number) => number;
};

function wingSide(
  spec: HouseSpec,
  facing: Dir,
  roll: (i: number) => number,
): Dir | null {
  if (spec.wing === "none") {
    return null;
  }
  if (spec.wing !== undefined && spec.wing !== "auto") {
    return spec.wing;
  }
  if (roll(7) >= 0.6) {
    return null;
  }
  const sides = (["left", "right", "back", "front"] as const).filter(
    (dir) => dir !== facing,
  );
  return sides[Math.floor(roll(8) * sides.length)] ?? null;
}

function footprint(
  spec: HouseSpec,
  facing: Dir,
  roll: (i: number) => number,
): Fp {
  const long = odd(spec.w ?? [7, 9, 11][Math.floor(roll(1) * 3)] ?? 9);
  const short = odd(spec.d ?? [5, 7, 9][Math.floor(roll(2) * 3)] ?? 7);
  const sized = spec.w !== undefined || spec.d !== undefined;
  const sideways = facing === "left" || facing === "right";
  return !sized && sideways
    ? { x: spec.x, z: spec.z, w: short, d: long }
    : { x: spec.x, z: spec.z, w: long, d: short };
}

function resolve(ctx: BuildContext, spec: HouseSpec): Plan {
  const seed = spec.seed ?? 1;
  const roll = (i: number): number =>
    ctx.noise(spec.x + i * 7, spec.z - i * 3, {
      scale: 1,
      octaves: 1,
      salt: seed * 17 + i,
    });
  const facing = spec.facing ?? "front";
  const fp = footprint(spec, facing, roll);
  const storeys = spec.storeys ?? (roll(3) < 0.3 ? 1 : roll(3) < 0.85 ? 2 : 3);
  const big = storeys >= 2 && fp.w >= 9 && fp.d >= 9;
  const roofType =
    spec.roof ??
    (roll(4) < 0.5 ? "gable" : !big || roll(4) < 0.8 ? "hip" : "mansard");
  const style = spec.style ?? "medieval";
  const plinth = Math.max(0, spec.plinth ?? 1);
  return {
    fp,
    facing,
    storeys,
    roofType,
    style,
    p: housePalette(ctx, style, Math.floor(roll(5) * 6)),
    plinth,
    base: spec.base ?? spec.y - 1,
    floorY: spec.y + plinth,
    jetty: spec.jetty ?? (storeys >= 2 && isTimber(style) && roll(6) < 0.55),
    wing: wingSide(spec, facing, roll),
    doorAt: Math.floor((faceWidth(fp, facing) - 1) / 2),
    roll,
  };
}

/** The lower wing (built first so the main walls cut its roof cleanly). */
function buildWing(
  ctx: BuildContext,
  plan: Plan,
  side: Dir,
): { fp: Fp; top: number } {
  const { p } = plan;
  const fp = wingFootprint(plan.fp, side, plan.roll(9));
  ctx.craft.foundation({
    ...fp,
    y: plan.base,
    height: plan.floorY - plan.base,
    material: p.foundation,
  });
  const walls = storeyWalls(ctx, p, {
    fp,
    y: plan.floorY,
    h: 4 * Math.max(1, plan.storeys - 1) + 1,
    door: null,
    facing: plan.facing,
    infill: p.infill,
    rhythm: 1,
    shutters: false,
  });
  ctx.craft.gableRoof({
    ...fp,
    y: walls.top,
    ridge: side === "left" || side === "right" ? "x" : "z",
    stairs: p.roof,
    overhang: 1,
    gable: p.infill,
    eaves: true,
  });
  return { fp, top: walls.top + Math.ceil(Math.min(fp.w, fp.d) / 2) + 1 };
}

/** Corbels: upside-down stairs under a jettied storey. */
function corbels(ctx: BuildContext, plan: Plan, ground: StoreyWalls): void {
  ctx.craft.trim(ground.faces[plan.facing], {
    v: 4,
    material: ctx.mat.stairs(plan.p.roof, {
      ascend: OPPOSITE[plan.facing],
      half: "top",
    }),
  });
}

/** One storey of the main volume at `level` (0 = ground). */
function storey(
  ctx: BuildContext,
  plan: Plan,
  at: { level: number; fp: Fp; y: number },
): StoreyWalls {
  const { p } = plan;
  const { level, fp, y } = at;
  const walls = storeyWalls(ctx, p, {
    fp,
    y,
    h: level === 0 ? 5 : 4,
    door: level === 0 ? plan.doorAt : null,
    facing: plan.facing,
    infill: level === 0 ? p.infill : p.upper,
    rhythm: (level + Math.floor(plan.roll(13) * 2)) % 2,
    shutters: plan.roll(14) < 0.5,
  });
  if (level > 0) {
    for (const face of Object.values(walls.faces)) {
      ctx.craft.trim(face, { v: 0, material: p.trim });
    }
  }
  return walls;
}

/** Every storey of the main volume; returns the ground walls, top fp and y. */
function buildStoreys(
  ctx: BuildContext,
  plan: Plan,
): { ground: StoreyWalls; fp: Fp; y: number } {
  const ground = storey(ctx, plan, { level: 0, fp: plan.fp, y: plan.floorY });
  let fp = plan.fp;
  let y = ground.top;
  for (let level = 1; level < plan.storeys; level += 1) {
    ctx.craft.floor({
      x: fp.x + 1,
      z: fp.z + 1,
      w: fp.w - 2,
      d: fp.d - 2,
      y: y - 1,
      material: plan.p.floor,
    });
    if (level === 1 && plan.jetty) {
      fp = grow(fp, plan.facing);
      corbels(ctx, plan, ground);
    }
    y = storey(ctx, plan, { level, fp, y }).top;
  }
  return { ground, fp, y };
}

/** Door, step, optional porch and chimney; returns the highest y reached. */
function finish(
  ctx: BuildContext,
  plan: Plan,
  spec: HouseSpec,
  built: { ground: StoreyWalls; fp: Fp; ridgeTop: number },
): { door: Vec3; top: number } {
  const { p } = plan;
  const front = built.ground.faces[plan.facing];
  const door = ctx.craft.door(front, { at: plan.doorAt, door: p.door }).pos;
  step(ctx, door, { facing: plan.facing, plinth: plan.plinth, stairs: p.roof });
  const porchFits =
    plan.storeys <= 2 &&
    isTimber(plan.style) &&
    faceWidth(plan.fp, plan.facing) >= 7;
  if (spec.porch ?? (porchFits && plan.roll(10) < 0.35)) {
    ctx.craft.porch({
      face: front,
      at: plan.doorAt - 2,
      w: 5,
      depth: 2,
      floor: p.porchFloor,
      post: p.porchPost,
      roof: p.roof,
      railing: p.porchPost,
    });
  }
  let top = built.ridgeTop;
  if (spec.chimney ?? plan.roll(11) < 0.75) {
    top = Math.max(
      top,
      chimney(ctx, p, {
        fp: built.fp,
        base: plan.base,
        ridgeTop: built.ridgeTop,
        roofType: plan.roofType,
        wingSide: plan.wing,
        roll: plan.roll(12),
      }),
    );
  }
  return { door, top };
}

export function house(ctx: BuildContext, spec: HouseSpec): House {
  const plan = resolve(ctx, spec);
  const { p } = plan;
  const footprints: Fp[] = [plan.fp];
  let top = plan.floorY;
  if (plan.wing !== null) {
    const wing = buildWing(ctx, plan, plan.wing);
    footprints.push(wing.fp);
    top = wing.top;
  }
  ctx.craft.foundation({
    ...plan.fp,
    y: plan.base,
    height: plan.floorY - plan.base,
    material: p.foundation,
  });
  const storeys = buildStoreys(ctx, plan);
  const ridgeTop = roof(ctx, p, {
    fp: storeys.fp,
    y: storeys.y,
    type: plan.roofType,
    gable: p.upper,
  });
  const done = finish(ctx, plan, spec, { ...storeys, ridgeTop });
  return { top: Math.max(top, done.top), door: done.door, footprints };
}
