import type { BuildCanvas } from "./canvas.ts";
import type { Mat } from "./mat.ts";
import {
  AIR,
  KEEP,
  OPPOSITE,
  WORLD_FACING,
  type Box,
  type Dir,
  type Material,
  type Site,
  type Vec3,
} from "./types.ts";

/** Footprint of a building: origin corner plus width (x) and depth (z). */
export type Footprint = { x: number; z: number; w: number; d: number };

/**
 * One side of a walled box, addressed the way you see it from outside:
 * `u` runs left→right, `v` runs up from the wall base, `layer` 0 is the outer
 * (perimeter) plane, 1 is one block inward, -1 is one block outside.
 */
export type WallFace = {
  dir: Dir;
  width: number;
  height: number;
  base: number;
  cell: (u: number, v: number, layer?: number) => Vec3;
};

export type Walls = {
  faces: Record<Dir, WallFace>;
  /** First y above the walls (where a roof starts). */
  top: number;
  /** Interior floor area just inside the infill plane. */
  interior: Box;
};

export type WallSpec = Footprint & {
  y: number;
  h: number;
  frame: string;
  infill: Material;
  postEvery?: number;
  /** Explicit post positions per face (u values), e.g. to frame a door. */
  postsAt?: Partial<Record<Dir, readonly number[]>>;
  /** 1 (default): infill recessed one block behind the frame; 0: flush. */
  depth?: 0 | 1;
  beams?: boolean;
};

export type WindowSpec = {
  at: number;
  y?: number;
  w?: number;
  h?: number;
  glass?: string;
  sill?: string;
  shutters?: string;
  depth?: 0 | 1;
};

export type RoofSpec = Footprint & {
  y: number;
  ridge: "x" | "z";
  stairs: string;
  ridgeBlock?: string;
  overhang?: number;
  gable?: Material;
  eaves?: boolean;
};

function makeFace(
  fp: Footprint,
  base: number,
  height: number,
  dir: Dir,
): WallFace {
  const xMax = fp.x + fp.w - 1;
  const zMax = fp.z + fp.d - 1;
  const across = dir === "front" || dir === "back" ? fp.w : fp.d;
  const cells: Record<Dir, WallFace["cell"]> = {
    front: (u, v, layer = 0) => ({ x: fp.x + u, y: base + v, z: zMax - layer }),
    back: (u, v, layer = 0) => ({ x: xMax - u, y: base + v, z: fp.z + layer }),
    right: (u, v, layer = 0) => ({ x: xMax - layer, y: base + v, z: zMax - u }),
    left: (u, v, layer = 0) => ({ x: fp.x + layer, y: base + v, z: fp.z + u }),
  };
  return { dir, width: across, height, base, cell: cells[dir] };
}

/** Axis a face runs along (for horizontal beams). */
function faceAxis(dir: Dir): "x" | "z" {
  return dir === "front" || dir === "back" ? "x" : "z";
}

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

export function createCraft(canvas: BuildCanvas, mat: Mat, site: Site | null) {
  const put = (p: Vec3, material: Material) => {
    canvas.set(p.x, p.y, p.z, material);
  };

  function extendToGround(
    spec: Footprint & { y: number; material: Material },
    ground: Site,
  ): void {
    for (let x = spec.x; x < spec.x + spec.w; x += 1) {
      for (let z = spec.z; z < spec.z + spec.d; z += 1) {
        const height = ground.heightAt(x, z) ?? spec.y;
        for (let y = height; y < spec.y; y += 1) {
          canvas.set(x, y, z, spec.material);
        }
      }
    }
  }

  /**
   * A solid plinth under a footprint. With a captured site, each column also
   * extends down to the terrain so the build never floats.
   */
  function foundation(
    spec: Footprint & { y: number; height?: number; material: Material },
  ) {
    const height = spec.height ?? 1;
    canvas.fill(
      { x: spec.x, y: spec.y, z: spec.z, w: spec.w, h: height, d: spec.d },
      spec.material,
    );
    if (site !== null) {
      extendToGround(spec, site);
    }
    return { top: spec.y + height };
  }

  function floor(spec: Footprint & { y: number; material: Material }) {
    canvas.fill(
      { x: spec.x, y: spec.y, z: spec.z, w: spec.w, h: 1, d: spec.d },
      spec.material,
    );
    return { top: spec.y + 1 };
  }

  function wallFace(spec: WallSpec, face: WallFace): void {
    const depth = spec.depth ?? 1;
    const postEvery = spec.postEvery ?? 4;
    const beams = spec.beams ?? true;
    const beam = mat.axis(spec.frame, faceAxis(face.dir));
    const post = mat.axis(spec.frame, "y");
    const explicit = spec.postsAt?.[face.dir];
    const isPost = (u: number) =>
      u === 0 ||
      u === face.width - 1 ||
      (explicit?.includes(u) ?? u % postEvery === 0);
    for (let u = 0; u < face.width; u += 1) {
      for (let v = 0; v < face.height; v += 1) {
        const isBeam = beams && (v === 0 || v === face.height - 1);
        if (isPost(u)) {
          put(face.cell(u, v), post);
        } else if (isBeam) {
          put(face.cell(u, v), beam);
        } else if (depth === 0) {
          put(face.cell(u, v), spec.infill);
        }
        // Recessed walls are two thick: a continuous inner infill plane
        // behind the frame (no gaps at the beams), with the outer plane empty
        // between posts and beams so the panels read as set back. Corner
        // columns belong to the neighbouring face's outer plane.
        if (depth === 1 && u > 0 && u < face.width - 1) {
          put(face.cell(u, v, 1), spec.infill);
        }
      }
    }
  }

  /**
   * Timber-frame walls on a footprint's perimeter: log posts at corners and
   * every `postEvery` cells, log beams along the base and top, and `infill`
   * panels recessed `depth` blocks inward (0 = flush) so the frame stands proud.
   */
  function walls(spec: WallSpec): Walls {
    const faces: Record<Dir, WallFace> = {
      front: makeFace(spec, spec.y, spec.h, "front"),
      back: makeFace(spec, spec.y, spec.h, "back"),
      left: makeFace(spec, spec.y, spec.h, "left"),
      right: makeFace(spec, spec.y, spec.h, "right"),
    };
    for (const face of Object.values(faces)) {
      wallFace(spec, face);
    }
    const inset = (spec.depth ?? 1) + 1;
    return {
      faces,
      top: spec.y + spec.h,
      interior: {
        x: spec.x + inset,
        y: spec.y,
        z: spec.z + inset,
        w: spec.w - 2 * inset,
        h: spec.h,
        d: spec.d - 2 * inset,
      },
    };
  }

  function shutters(face: WallFace, spec: WindowSpec, shutter: string): void {
    // An open trapdoor rests against the side opposite its facing, so facing
    // outward lays it flat against the wall.
    const state = mat.block(shutter, {
      facing: WORLD_FACING[face.dir],
      open: "true",
      half: "top",
    });
    const v0 = spec.y ?? 1;
    for (const u of [spec.at - 1, spec.at + (spec.w ?? 1)]) {
      for (let v = v0; v < v0 + (spec.h ?? 2); v += 1) {
        // Sit in the recess against the infill when the outer plane is open
        // there; otherwise hang on the outside of the post or beam.
        const outer = face.cell(u, v, 0);
        put(
          face.cell(
            u,
            v,
            canvas.get(outer.x, outer.y, outer.z) === KEEP ? 0 : -1,
          ),
          state,
        );
      }
    }
  }

  /**
   * A window opening `w`×`h` at `at` along a face, `y` above the wall base.
   * Glass goes in the recessed (infill) plane; a sill sits under it on the
   * outer plane and optional open shutters flank it.
   */
  function window(face: WallFace, spec: WindowSpec) {
    const w = spec.w ?? 1;
    const v0 = spec.y ?? 1;
    const recessed = (spec.depth ?? 1) === 1;
    const glass = spec.glass ?? mat.block("glass_pane");
    for (let u = spec.at; u < spec.at + w; u += 1) {
      for (let v = v0; v < v0 + (spec.h ?? 2); v += 1) {
        put(face.cell(u, v, 0), recessed ? AIR : glass);
        if (recessed) {
          put(face.cell(u, v, 1), glass);
        }
      }
      if (spec.sill !== undefined) {
        put(
          face.cell(u, v0 - 1, -1),
          mat.stairs(spec.sill, { ascend: OPPOSITE[face.dir], half: "top" }),
        );
      }
    }
    if (spec.shutters !== undefined) {
      shutters(face, spec, spec.shutters);
    }
    return { left: spec.at, right: spec.at + w - 1, sillY: face.base + v0 - 1 };
  }

  /**
   * A two-block door at `at` along a face, standing on the floor (the wall
   * base), opening inward. With depth 1 the outer plane is cleared in front of
   * it so the doorway reads as an opening in the frame.
   */
  function door(
    face: WallFace,
    spec: { at: number; door: string; depth?: 0 | 1 },
  ) {
    const recessed = (spec.depth ?? 1) === 1;
    const inward = WORLD_FACING[OPPOSITE[face.dir]];
    const layer = recessed ? 1 : 0;
    for (const [v, half] of [
      [0, "lower"],
      [1, "upper"],
    ] as const) {
      if (recessed) {
        put(face.cell(spec.at, v, 0), AIR);
      }
      put(
        face.cell(spec.at, v, layer),
        mat.block(spec.door, {
          facing: inward,
          half,
          hinge: "left",
          open: "false",
        }),
      );
    }
    return { pos: face.cell(spec.at, 0, layer) };
  }

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
      const ridge = mat.block(
        spec.ridgeBlock ?? spec.stairs.replace(/_stairs(?:\[.*)?$/u, "_slab"),
      );
      for (const run of frame.runs) {
        put(frame.at(run, frame.lo + layer, ridgeY), ridge);
      }
    }
    return { ridgeY };
  }

  /** A horizontal band on the outer plane (layer -1 protrudes, 0 is flush). */
  function trim(
    face: WallFace,
    spec: { v: number; material: Material; layer?: number },
  ) {
    for (let u = 0; u < face.width; u += 1) {
      put(face.cell(u, spec.v, spec.layer ?? -1), spec.material);
    }
  }

  return { foundation, floor, walls, window, door, gableRoof, trim };
}

export type Craft = ReturnType<typeof createCraft>;
