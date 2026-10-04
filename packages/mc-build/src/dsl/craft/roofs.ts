import {
  AIR,
  KEEP,
  OPPOSITE,
  type Dir,
  type Material,
  type Vec3,
} from "#src/dsl/types.ts";
import { outward, slabFor, type CraftKit, type Footprint } from "./kit.ts";
import { makeFace, type WallFace } from "./walls.ts";

export type RoofSpec = Footprint & {
  y: number;
  ridge: "x" | "z";
  stairs: string;
  ridgeBlock?: string;
  overhang?: number;
  gable?: Material;
  eaves?: boolean;
};

export type HipRoofSpec = Footprint & {
  y: number;
  stairs: string;
  /** Caps the ridge line left by an odd span (default: the stairs' slab). */
  ridgeBlock?: string;
  overhang?: number;
  /** Upside-down stairs under the overhang edge. */
  eaves?: boolean;
};

export type ConicalRoofSpec = {
  /** Center column of the cone (usually a round tower's center). */
  x: number;
  z: number;
  y: number;
  /** Radius of the wall below; the cone starts `overhang` beyond it. */
  radius: number;
  stairs: string;
  overhang?: number;
  /** Placed on the apex, e.g. a lightning rod or a lantern on a fence. */
  peak?: string;
};

export type MansardRoofSpec = Footprint & {
  y: number;
  /** Steep lower slopes: full blocks, two high per step. */
  wall: Material;
  stairs: string;
  /** Inward steps of the steep slope (default 2). */
  steps?: number;
  /** Flat top over what remains (default: the stairs' slab). */
  cap?: string;
};

export type DormerSpec = Footprint & {
  /** First y of the dormer (usually the walls' `top`, inside the main roof). */
  y: number;
  /** The side of the footprint the window faces. */
  facing: Dir;
  wall: Material;
  stairs: string;
  /** Window height (default 2). */
  h?: number;
  glass?: string;
};

/** Roof geometry in run (along the ridge) / across (down the slopes) terms. */
type RoofFrame = {
  lo: number;
  hi: number;
  runs: number[];
  ends: number[];
  wallLo: number;
  wallHi: number;
  at: (run: number, across: number, y: number) => Vec3;
  ascendLo: Dir;
  ascendHi: Dir;
};

function roofFrame(spec: RoofSpec): RoofFrame {
  const overhang = spec.overhang ?? 1;
  const alongX = spec.ridge === "x";
  const runStart = alongX ? spec.x : spec.z;
  const runLength = alongX ? spec.w : spec.d;
  const acrossStart = alongX ? spec.z : spec.x;
  const acrossLength = alongX ? spec.d : spec.w;
  const runs: number[] = [];
  for (
    let run = runStart - overhang;
    run <= runStart + runLength - 1 + overhang;
    run += 1
  ) {
    runs.push(run);
  }
  return {
    lo: acrossStart - overhang,
    hi: acrossStart + acrossLength - 1 + overhang,
    runs,
    ends: [runStart, runStart + runLength - 1],
    wallLo: acrossStart,
    wallHi: acrossStart + acrossLength - 1,
    at: (run, across, y) =>
      alongX ? { x: run, y, z: across } : { x: across, y, z: run },
    // The lo-side slope climbs toward hi and vice versa.
    ascendLo: alongX ? "front" : "right",
    ascendHi: alongX ? "back" : "left",
  };
}

type Rect = { lx: number; hx: number; lz: number; hz: number };

/** One ring of slope cells around `rect`, each with the way it climbs. */
function hipRing(rect: Rect, y: number): [Vec3, Dir][] {
  const cells: [Vec3, Dir][] = [];
  for (let x = rect.lx; x <= rect.hx; x += 1) {
    cells.push([{ x, y, z: rect.hz }, "back"], [{ x, y, z: rect.lz }, "front"]);
  }
  for (let z = rect.lz + 1; z < rect.hz; z += 1) {
    cells.push([{ x: rect.lx, y, z }, "right"], [{ x: rect.hx, y, z }, "left"]);
  }
  return cells;
}

function inset(rect: Rect, k: number): Rect {
  return { lx: rect.lx + k, hx: rect.hx - k, lz: rect.lz + k, hz: rect.hz - k };
}

/**
 * Hip roof layers from the eaves up: each a ring of slope cells stepping in
 * one block, ending in a ridge line (`null` direction) when one span is odd.
 */
function hipLayers(outer: Rect, y0: number): [Vec3, Dir | null][][] {
  const layers: [Vec3, Dir | null][][] = [];
  for (let k = 0; ; k += 1) {
    const rect = inset(outer, k);
    if (rect.lx > rect.hx || rect.lz > rect.hz) {
      return layers;
    }
    const y = y0 + k;
    if (rect.lx < rect.hx && rect.lz < rect.hz) {
      layers.push(hipRing(rect, y));
      continue;
    }
    const ridge: [Vec3, null][] = [];
    for (let x = rect.lx; x <= rect.hx; x += 1) {
      for (let z = rect.lz; z <= rect.hz; z += 1) {
        ridge.push([{ x, y, z }, null]);
      }
    }
    layers.push(ridge);
  }
}

function cellKey(dx: number, dz: number): string {
  return `${dx.toString()},${dz.toString()}`;
}

/** Cells of a filled disc of radius `r` (r < 0 is empty) around a center. */
function disc(r: number): [number, number][] {
  const cells: [number, number][] = [];
  if (r < 0) {
    return cells;
  }
  const limit = (r + 0.5) ** 2;
  for (let dx = -r; dx <= r; dx += 1) {
    for (let dz = -r; dz <= r; dz += 1) {
      if (dx * dx + dz * dz <= limit) {
        cells.push([dx, dz]);
      }
    }
  }
  return cells;
}

export function roofParts(kit: CraftKit) {
  const { canvas, mat, put } = kit;

  function roofLayer(spec: RoofSpec, frame: RoofFrame, layer: number): void {
    const y = spec.y + layer;
    const lower = mat.stairs(spec.stairs, { ascend: frame.ascendLo });
    const upper = mat.stairs(spec.stairs, { ascend: frame.ascendHi });
    for (const run of frame.runs) {
      put(frame.at(run, frame.lo + layer, y), lower);
      put(frame.at(run, frame.hi - layer, y), upper);
    }
    if (layer === 0 && spec.eaves === true) {
      const eaveLo = mat.stairs(spec.stairs, {
        ascend: frame.ascendHi,
        half: "top",
      });
      const eaveHi = mat.stairs(spec.stairs, {
        ascend: frame.ascendLo,
        half: "top",
      });
      for (const run of frame.runs) {
        put(frame.at(run, frame.lo, y - 1), eaveLo);
        put(frame.at(run, frame.hi, y - 1), eaveHi);
      }
    }
  }

  function gableLayer(
    spec: RoofSpec,
    frame: RoofFrame,
    layer: number,
    gable: Material,
  ): void {
    const from = Math.max(frame.lo + layer + 1, frame.wallLo);
    const to = Math.min(frame.hi - layer - 1, frame.wallHi);
    for (const run of frame.ends) {
      for (let across = from; across <= to; across += 1) {
        put(frame.at(run, across, spec.y + layer), gable);
      }
    }
  }

  /**
   * A gable roof of stairs over a footprint starting at `y` (usually the walls'
   * `top`). The ridge runs along `ridge`; `overhang` extends past the walls on
   * every side. Gable ends under the slope are filled with `gable`.
   */
  function gableRoof(spec: RoofSpec) {
    const frame = roofFrame(spec);
    let layer = 0;
    for (; frame.lo + layer < frame.hi - layer; layer += 1) {
      roofLayer(spec, frame, layer);
      if (spec.gable !== undefined) {
        gableLayer(spec, frame, layer, spec.gable);
      }
    }
    const ridgeY = spec.y + layer;
    if (frame.lo + layer === frame.hi - layer) {
      // Odd span: cap the single middle row.
      const ridge = mat.block(spec.ridgeBlock ?? slabFor(spec.stairs));
      for (const run of frame.runs) {
        put(frame.at(run, frame.lo + layer, ridgeY), ridge);
      }
    }
    return { ridgeY };
  }

  /** Upside-down stair or block under a roof cell, connecting it downward. */
  function underside(p: Vec3, material: string): void {
    if (canvas.get(p.x, p.y - 1, p.z) === KEEP) {
      put({ ...p, y: p.y - 1 }, material);
    }
  }

  /**
   * A hip roof: stairs slope up from all four sides of a footprint starting at
   * `y` (usually the walls' `top`), stepping in one block per layer. Corners
   * get outer-corner stair shapes; an odd span leaves a ridge line capped with
   * `ridgeBlock`. Every layer above the first rests on upside-down stairs so
   * the roof is one connected structure.
   */
  function hipRoof(spec: HipRoofSpec) {
    const overhang = spec.overhang ?? 1;
    const outer = {
      lx: spec.x - overhang,
      hx: spec.x + spec.w - 1 + overhang,
      lz: spec.z - overhang,
      hz: spec.z + spec.d - 1 + overhang,
    };
    const ridge = mat.block(spec.ridgeBlock ?? slabFor(spec.stairs));
    const slope = (ascend: Dir) => mat.stairs(spec.stairs, { ascend });
    const under = (ascend: Dir) =>
      mat.stairs(spec.stairs, { ascend: OPPOSITE[ascend], half: "top" });
    let top = spec.y;
    for (const [k, cells] of hipLayers(outer, spec.y).entries()) {
      for (const [p, ascend] of cells) {
        put(p, ascend === null ? ridge : slope(ascend));
        if (k > 0) {
          underside(p, under(ascend ?? "back"));
        } else if (ascend !== null && spec.eaves === true) {
          underside(p, under(ascend));
        }
        top = p.y;
      }
    }
    return { ridgeY: top };
  }

  /**
   * A stepped cone of stairs around a center column, for round towers: each
   * layer is a ring one block smaller, resting on upside-down stairs, with a
   * slab (or `peak`) on the apex.
   */
  function conicalRoof(spec: ConicalRoofSpec) {
    const outerRadius = spec.radius + (spec.overhang ?? 1);
    const under = (ascend: Dir) =>
      mat.stairs(spec.stairs, { ascend: OPPOSITE[ascend], half: "top" });
    let y = spec.y;
    for (let r = outerRadius; r > 0; r -= 1) {
      const inner = new Set(disc(r - 1).map(([dx, dz]) => cellKey(dx, dz)));
      for (const [dx, dz] of disc(r)) {
        if (inner.has(cellKey(dx, dz))) {
          continue;
        }
        const ascend = OPPOSITE[outward(dx, dz)];
        const p = { x: spec.x + dx, y, z: spec.z + dz };
        put(p, mat.stairs(spec.stairs, { ascend }));
        if (r < outerRadius) {
          underside(p, under(ascend));
        }
      }
      y += 1;
    }
    const apex = { x: spec.x, y, z: spec.z };
    put(apex, mat.block(slabFor(spec.stairs)));
    underside(apex, mat.block(slabFor(spec.stairs), { type: "top" }));
    if (spec.peak !== undefined) {
      put({ ...apex, y: y + 1 }, mat.block(spec.peak));
      return { top: y + 2 };
    }
    return { top: y + 1 };
  }

  /**
   * A mansard roof: steep lower slopes of full blocks topped by stairs, two
   * blocks high per inward step, finished with a flat cap. Pair it with
   * dormers for a French or Victorian look.
   */
  function mansardRoof(spec: MansardRoofSpec) {
    const steps = spec.steps ?? 2;
    const outer = {
      lx: spec.x,
      hx: spec.x + spec.w - 1,
      lz: spec.z,
      hz: spec.z + spec.d - 1,
    };
    for (let i = 0; i < steps; i += 1) {
      const rect = inset(outer, i);
      if (rect.lx >= rect.hx || rect.lz >= rect.hz) {
        break;
      }
      for (const [p, ascend] of hipRing(rect, spec.y + 2 * i)) {
        put(p, spec.wall);
        if (i > 0 && canvas.get(p.x, p.y - 1, p.z) === KEEP) {
          // Rest each step on the one below.
          put({ ...p, y: p.y - 1 }, spec.wall);
        }
        put({ ...p, y: p.y + 1 }, mat.stairs(spec.stairs, { ascend }));
      }
    }
    const capRect = inset(outer, steps);
    const capY = spec.y + 2 * steps - 1;
    const cap = mat.block(spec.cap ?? slabFor(spec.stairs));
    for (let x = capRect.lx; x <= capRect.hx; x += 1) {
      for (let z = capRect.lz; z <= capRect.hz; z += 1) {
        put({ x, y: capY, z }, cap);
      }
    }
    return { top: capY + 1 };
  }

  /**
   * A dormer: a small gabled box with a window, built into a roof slope after
   * the main roof (it carves its own interior). The footprint's `facing` side
   * holds the window; the opposite side opens into the attic.
   */
  /** Clears the dormer's volume, cutting it out of the main roof. */
  function carve(spec: DormerSpec, h: number): void {
    for (let x = spec.x; x < spec.x + spec.w; x += 1) {
      for (let z = spec.z; z < spec.z + spec.d; z += 1) {
        canvas.fill({ x, y: spec.y, z, w: 1, h: h + 3, d: 1 }, AIR);
      }
    }
  }

  function solidFace(face: WallFace, material: Material): void {
    for (let u = 0; u < face.width; u += 1) {
      canvas.fill({ ...face.cell(u, 0), w: 1, h: face.height, d: 1 }, material);
    }
  }

  /**
   * A dormer: a small gabled box with a window, built into a roof slope after
   * the main roof (it carves its own interior). The footprint's `facing` side
   * holds the window; the opposite side opens into the attic.
   */
  function dormer(spec: DormerSpec) {
    const h = spec.h ?? 2;
    const across = spec.facing === "front" || spec.facing === "back";
    carve(spec, h);
    for (const dir of across
      ? (["left", "right"] as const)
      : (["front", "back"] as const)) {
      solidFace(makeFace(spec, spec.y, h, dir), spec.wall);
    }
    const front = makeFace(spec, spec.y, h, spec.facing);
    const glass = mat.block(spec.glass ?? "glass_pane");
    for (let u = 0; u < front.width; u += 1) {
      const edge = u === 0 || u === front.width - 1;
      canvas.fill(
        { ...front.cell(u, 0), w: 1, h, d: 1 },
        edge ? spec.wall : glass,
      );
    }
    return gableRoof({
      x: spec.x,
      z: spec.z,
      w: spec.w,
      d: spec.d,
      y: spec.y + h,
      ridge: across ? "z" : "x",
      stairs: spec.stairs,
      overhang: 0,
      gable: spec.wall,
    });
  }

  return { gableRoof, hipRoof, conicalRoof, mansardRoof, dormer };
}
