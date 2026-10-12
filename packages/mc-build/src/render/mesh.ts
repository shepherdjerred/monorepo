import { blockId, isAir } from "#src/core/block-state.ts";
import type { BlockGrid } from "#src/core/grid.ts";
import {
  DIRECTIONS,
  type AppliedModel,
  type Direction,
  type ModelResolver,
  type ResolvedElement,
} from "./models.ts";
import type { Texture, TextureCache } from "./textures.ts";
import { GRASS, tintFor } from "./tint.ts";

export type V3 = [number, number, number];
export type Layer = "solid" | "cutout" | "translucent";

/** One textured face in world units (1 = one block). */
export type Quad = {
  corners: [V3, V3, V3, V3];
  /** UV per corner in 0..16 texture space. */
  uv: [[number, number], [number, number], [number, number], [number, number]];
  texture: Texture;
  /** Per-channel multiplier: face shade × biome tint. */
  color: V3;
  layer: Layer;
  /** Fixed alpha for synthesized translucent faces (water), else 1. */
  alpha: number;
  /** Outward unit normal in world space; null when the face has no cull direction. */
  normal: V3 | null;
};

type LocalFace = {
  corners: [V3, V3, V3, V3];
  uv: Quad["uv"];
  texture: string;
  normal: Direction | null;
  cull: Direction | null;
  shade: boolean;
  tinted: boolean;
};

type BlockMesh = {
  faces: LocalFace[];
  fullOpaque: boolean;
  fluid: "water" | "lava" | null;
};

const INVISIBLE = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
  "minecraft:barrier",
  "minecraft:light",
  "minecraft:structure_void",
]);

const NORMALS: Record<Direction, V3> = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};

const OFFSET: Record<Direction, V3> = NORMALS;

const SHADE: Record<Direction, number> = {
  up: 1,
  down: 0.5,
  north: 0.8,
  south: 0.8,
  east: 0.6,
  west: 0.6,
};

function directionOf(vector: V3): Direction {
  let best: Direction = "up";
  let bestDot = -Infinity;
  for (const direction of DIRECTIONS) {
    const n = NORMALS[direction];
    const dot = n[0] * vector[0] + n[1] * vector[1] + n[2] * vector[2];
    if (dot > bestDot) {
      bestDot = dot;
      best = direction;
    }
  }
  return best;
}

// Variant rotations in 0..16 model space (x first, then y; 90° steps).
function rotateX90(p: V3): V3 {
  return [p[0], p[2], 16 - p[1]];
}
function rotateY90(p: V3): V3 {
  return [16 - p[2], p[1], p[0]];
}
function rotateVecX90(v: V3): V3 {
  return [v[0], v[2], -v[1]];
}
function rotateVecY90(v: V3): V3 {
  return [-v[2], v[1], v[0]];
}
function repeat<T>(value: T, times: number, fn: (value: T) => T): T {
  let out = value;
  for (let index = 0; index < ((times % 4) + 4) % 4; index += 1) {
    out = fn(out);
  }
  return out;
}

function rotateElementPoint(p: V3, rotation: ResolvedElement["rotation"]): V3 {
  if (rotation === undefined || rotation.angle === 0) {
    return p;
  }
  const radians = (rotation.angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const [ox, oy, oz] = rotation.origin;
  const x = p[0] - ox;
  const y = p[1] - oy;
  const z = p[2] - oz;
  switch (rotation.axis) {
    case "x": {
      return [p[0], oy + y * cos - z * sin, oz + y * sin + z * cos];
    }
    case "y": {
      return [ox + x * cos + z * sin, p[1], oz - x * sin + z * cos];
    }
    case "z": {
      return [ox + x * cos - y * sin, oy + x * sin + y * cos, p[2]];
    }
  }
}

function faceCorners(direction: Direction, from: V3, to: V3): [V3, V3, V3, V3] {
  const [x1, y1, z1] = from;
  const [x2, y2, z2] = to;
  switch (direction) {
    case "north": {
      return [
        [x2, y2, z1],
        [x1, y2, z1],
        [x1, y1, z1],
        [x2, y1, z1],
      ];
    }
    case "south": {
      return [
        [x1, y2, z2],
        [x2, y2, z2],
        [x2, y1, z2],
        [x1, y1, z2],
      ];
    }
    case "west": {
      return [
        [x1, y2, z1],
        [x1, y2, z2],
        [x1, y1, z2],
        [x1, y1, z1],
      ];
    }
    case "east": {
      return [
        [x2, y2, z2],
        [x2, y2, z1],
        [x2, y1, z1],
        [x2, y1, z2],
      ];
    }
    case "up": {
      return [
        [x1, y2, z1],
        [x2, y2, z1],
        [x2, y2, z2],
        [x1, y2, z2],
      ];
    }
    case "down": {
      return [
        [x1, y1, z2],
        [x2, y1, z2],
        [x2, y1, z1],
        [x1, y1, z1],
      ];
    }
  }
}

function mapCorners(
  corners: readonly [V3, V3, V3, V3],
  fn: (corner: V3) => V3,
): [V3, V3, V3, V3] {
  return [fn(corners[0]), fn(corners[1]), fn(corners[2]), fn(corners[3])];
}

function toBlockUnits(corner: V3): V3 {
  return [corner[0] / 16, corner[1] / 16, corner[2] / 16];
}

function faceUv(
  uv: [number, number, number, number],
  rotation: number,
): Quad["uv"] {
  const [u1, v1, u2, v2] = uv;
  const corners: Quad["uv"] = [
    [u1, v1],
    [u2, v1],
    [u2, v2],
    [u1, v2],
  ];
  const steps = Math.round(rotation / 90) % 4;
  return repeat(corners, steps, (list) => [list[3], list[0], list[1], list[2]]);
}

function rotatedNormal(element: ResolvedElement, direction: Direction): V3 {
  const normal = NORMALS[direction];
  if (element.rotation === undefined || element.rotation.angle === 0) {
    return normal;
  }
  const tip = rotateElementPoint(
    [8 + normal[0], 8 + normal[1], 8 + normal[2]],
    {
      ...element.rotation,
      origin: [8, 8, 8],
    },
  );
  return [tip[0] - 8, tip[1] - 8, tip[2] - 8];
}

function elementFaces(
  element: ResolvedElement,
  applied: AppliedModel,
): LocalFace[] {
  const xSteps = applied.x / 90;
  const ySteps = applied.y / 90;
  const variantPoint = (corner: V3) =>
    repeat(repeat(corner, xSteps, rotateX90), ySteps, rotateY90);
  const variantVector = (vector: V3) =>
    repeat(repeat(vector, xSteps, rotateVecX90), ySteps, rotateVecY90);
  const faces: LocalFace[] = [];
  for (const direction of DIRECTIONS) {
    const face = element.faces[direction];
    if (face !== undefined) {
      faces.push({
        corners: mapCorners(
          faceCorners(direction, element.from, element.to),
          (corner) =>
            toBlockUnits(
              variantPoint(rotateElementPoint(corner, element.rotation)),
            ),
        ),
        uv: faceUv(face.uv, face.rotation),
        texture: face.texture,
        normal: directionOf(variantVector(rotatedNormal(element, direction))),
        cull:
          face.cullface === null
            ? null
            : directionOf(variantVector(NORMALS[face.cullface])),
        shade: element.shade,
        tinted: face.tinted,
      });
    }
  }
  return faces;
}

function boxFaces(
  from: V3,
  to: V3,
  texture: string,
  tinted: boolean,
): LocalFace[] {
  return DIRECTIONS.map((direction) => ({
    corners: mapCorners(faceCorners(direction, from, to), toBlockUnits),
    uv: faceUv(
      direction === "up" || direction === "down"
        ? [from[0], from[2], to[0], to[2]]
        : [from[0], 16 - to[1], to[0], 16 - from[1]],
      0,
    ),
    texture,
    normal: direction,
    cull: null,
    shade: true,
    tinted,
  }));
}

/** Approximate shapes for blocks the game draws with entity renderers. */
function entityBox(id: string): [V3, V3] {
  const name = id.replace(/^minecraft:/u, "");
  if (name.endsWith("chest")) {
    return [
      [1, 0, 1],
      [15, 14, 15],
    ];
  }
  if (name.endsWith("_bed")) {
    return [
      [0, 0, 0],
      [16, 9, 16],
    ];
  }
  if (name.endsWith("_wall_sign") || name.endsWith("_wall_hanging_sign")) {
    return [
      [0, 4, 14],
      [16, 12, 16],
    ];
  }
  if (name.endsWith("sign")) {
    return [
      [0, 7, 7],
      [16, 15, 9],
    ];
  }
  if (name.endsWith("banner")) {
    return [
      [2, 0, 7],
      [14, 16, 9],
    ];
  }
  if (name.endsWith("head") || name.endsWith("skull")) {
    return [
      [4, 0, 4],
      [12, 8, 12],
    ];
  }
  return name.endsWith("shulker_box")
    ? [
        [0, 0, 0],
        [16, 16, 16],
      ]
    : [
        [2, 0, 2],
        [14, 14, 14],
      ];
}

const EMPTY: BlockMesh = { faces: [], fullOpaque: false, fluid: null };

function fluidMesh(id: string): BlockMesh | null {
  if (id === "minecraft:lava") {
    return {
      faces: boxFaces([0, 0, 0], [16, 14, 16], "block/lava_still", false),
      fullOpaque: false,
      fluid: "lava",
    };
  }
  return id === "minecraft:water" || id === "minecraft:bubble_column"
    ? {
        faces: boxFaces([0, 0, 0], [16, 14, 16], "block/water_still", true),
        fullOpaque: false,
        fluid: "water",
      }
    : null;
}

/** A single unrotated 16³ element with all six faces (texture opacity aside). */
function isFullCube(applied: readonly AppliedModel[]): boolean {
  const [first] = applied;
  const single =
    applied.length === 1 && first?.model.elements.length === 1
      ? first.model.elements[0]
      : undefined;
  return (
    single !== undefined &&
    single.rotation === undefined &&
    single.from.every((value) => value === 0) &&
    single.to.every((value) => value === 16) &&
    DIRECTIONS.every((direction) => single.faces[direction] !== undefined)
  );
}

function faceQuad(input: {
  mesh: BlockMesh;
  face: LocalFace;
  texture: Texture;
  tint: V3;
  at: V3;
}): Quad {
  const { mesh, face, texture, tint, at } = input;
  const shade = face.shade && face.normal !== null ? SHADE[face.normal] : 1;
  const color: V3 = face.tinted
    ? [tint[0] * shade, tint[1] * shade, tint[2] * shade]
    : [shade, shade, shade];
  let layer: Layer = "solid";
  if (mesh.fluid === "water" || texture.translucent) {
    layer = "translucent";
  } else if (texture.cutout) {
    layer = "cutout";
  }
  return {
    corners: mapCorners(face.corners, (corner) => [
      corner[0] + at[0],
      corner[1] + at[1],
      corner[2] + at[2],
    ]),
    uv: face.uv,
    texture,
    color,
    layer,
    alpha: mesh.fluid === "water" ? 0.7 : 1,
    normal: face.normal === null ? null : NORMALS[face.normal],
  };
}

/** Turns a grid into textured quads with hidden faces culled. */
export class Mesher {
  constructor(
    private readonly models: ModelResolver,
    private readonly textures: TextureCache,
  ) {}

  private async blockMesh(state: string): Promise<BlockMesh> {
    const id = blockId(state);
    if (INVISIBLE.has(id) || isAir(state)) {
      return EMPTY;
    }
    const fluid = fluidMesh(id);
    if (fluid !== null) {
      return fluid;
    }
    const applied = await this.models.forState(state);
    const faces = applied.flatMap((model) =>
      model.model.elements.flatMap((element) => elementFaces(element, model)),
    );
    if (faces.length > 0) {
      return {
        faces,
        fullOpaque:
          isFullCube(applied) &&
          (await this.textures.opaque(faces.map((face) => face.texture))),
        fluid: null,
      };
    }
    // No elements: entity-rendered (chest, bed, sign…) or intentionally empty.
    const particle =
      applied.find((model) => model.model.particle !== null)?.model.particle ??
      null;
    if (particle === null && applied.length > 0) {
      return EMPTY;
    }
    const [from, to] = entityBox(id);
    return {
      faces: boxFaces(from, to, particle ?? "block/missing", false),
      fullOpaque: false,
      fluid: null,
    };
  }

  /** Use the same geometry and texture opacity as face culling for skylight. */
  async lightTransmission(grid: BlockGrid): Promise<Map<string, boolean>> {
    const entries = await Promise.all(
      grid.palette.map(async (state): Promise<[string, boolean]> => {
        const mesh = await this.blockMesh(state);
        const opaque =
          blockId(state) === "minecraft:tinted_glass" || mesh.fullOpaque;
        return [state, !opaque];
      }),
    );
    return new Map(entries);
  }

  async quads(grid: BlockGrid): Promise<Quad[]> {
    const meshes = await Promise.all(
      grid.palette.map(async (state) => this.blockMesh(state)),
    );
    const tints = grid.palette.map((state) => tintFor(blockId(state)));
    const textures = new Map<string, Texture>();
    for (const face of meshes.flatMap((mesh) => mesh.faces)) {
      textures.set(face.texture, await this.textures.get(face.texture));
    }
    const meshAt = (x: number, y: number, z: number): BlockMesh | null =>
      grid.inBounds(x, y, z)
        ? (meshes[grid.data[grid.index(x, y, z)] ?? 0] ?? null)
        : null;
    const hidden = (mesh: BlockMesh, face: LocalFace, at: V3): boolean => {
      const direction = face.cull ?? (mesh.fluid === null ? null : face.normal);
      if (direction === null) {
        return false;
      }
      const [dx, dy, dz] = OFFSET[direction];
      const neighbour = meshAt(at[0] + dx, at[1] + dy, at[2] + dz);
      return (
        neighbour?.fullOpaque === true ||
        (mesh.fluid !== null && neighbour?.fluid === mesh.fluid)
      );
    };
    const quads: Quad[] = [];
    grid.forEach((x, y, z) => {
      const index = grid.data[grid.index(x, y, z)] ?? 0;
      const mesh = meshes[index] ?? EMPTY;
      for (const face of mesh.faces) {
        const texture = textures.get(face.texture);
        if (texture !== undefined && !hidden(mesh, face, [x, y, z])) {
          quads.push(
            faceQuad({
              mesh,
              face,
              texture,
              tint: tints[index] ?? GRASS,
              at: [x, y, z],
            }),
          );
        }
      }
    });
    return quads;
  }
}
