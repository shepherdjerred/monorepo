import path from "node:path";
import sharp from "sharp";

/**
 * Wavefront OBJ + MTL, the subset mesh import needs: positions, texture
 * coordinates, polygon faces (fan-triangulated, 1-based or negative indices),
 * `usemtl`/`mtllib`, and per-material `Kd` color and `map_Kd` texture.
 */

export type Rgb = { r: number; g: number; b: number };
export type Vec3f = { x: number; y: number; z: number };
export type Vec2f = { u: number; v: number };

export type ObjTexture = { width: number; height: number; pixels: Uint8Array };

export type ObjMaterial = {
  name: string;
  color: Rgb;
  texture: ObjTexture | null;
};

export type Triangle = {
  positions: readonly [Vec3f, Vec3f, Vec3f];
  uvs: readonly [Vec2f, Vec2f, Vec2f] | null;
  material: ObjMaterial;
};

export type Mesh = { triangles: Triangle[] };

/** Faces with no material (no `usemtl`, or no MTL) are this neutral grey. */
export const UNMATERIALED: ObjMaterial = {
  name: "(none)",
  color: { r: 0.7, g: 0.7, b: 0.7 },
  texture: null,
};

export type ParsedObj = {
  positions: Vec3f[];
  uvs: Vec2f[];
  faces: {
    corners: { v: number; vt: number | null }[];
    material: string | null;
  }[];
  mtllibs: string[];
};

function resolveIndex(
  raw: string,
  count: number,
  kind: string,
  line: number,
): number {
  const value = Number.parseInt(raw, 10);
  if (value === 0 || !Number.isInteger(value)) {
    throw new Error(
      `OBJ line ${line.toString()}: invalid ${kind} index "${raw}"`,
    );
  }
  const index = value > 0 ? value - 1 : count + value;
  if (index < 0 || index >= count) {
    throw new Error(
      `OBJ line ${line.toString()}: ${kind} index ${raw} is out of range (${count.toString()} defined)`,
    );
  }
  return index;
}

function numbers(
  tokens: readonly string[],
  count: number,
  line: number,
): number[] {
  const values = tokens.slice(0, count).map(Number);
  if (
    values.length < count ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(
      `OBJ line ${line.toString()}: expected ${count.toString()} numbers, got "${tokens.join(" ")}"`,
    );
  }
  return values;
}

export function parseObj(text: string): ParsedObj {
  const positions: Vec3f[] = [];
  const uvs: Vec2f[] = [];
  const faces: ParsedObj["faces"] = [];
  const mtllibs: string[] = [];
  let material: string | null = null;
  text.split(/\r?\n/u).forEach((rawLine, lineIndex) => {
    const line = lineIndex + 1;
    const content = rawLine.replace(/#.*$/u, "").trim();
    if (content.length === 0) {
      return;
    }
    const [keyword, ...tokens] = content.split(/\s+/u);
    switch (keyword) {
      case "v": {
        const [x = 0, y = 0, z = 0] = numbers(tokens, 3, line);
        positions.push({ x, y, z });
        break;
      }
      case "vt": {
        const [u = 0, v = 0] = numbers(tokens, 2, line);
        uvs.push({ u, v });
        break;
      }
      case "f": {
        if (tokens.length < 3) {
          throw new Error(
            `OBJ line ${line.toString()}: a face needs at least 3 corners`,
          );
        }
        const corners = tokens.map((token) => {
          const [v = "", vt = ""] = token.split("/");
          return {
            v: resolveIndex(v, positions.length, "vertex", line),
            vt:
              vt.length === 0
                ? null
                : resolveIndex(vt, uvs.length, "texture", line),
          };
        });
        faces.push({ corners, material });
        break;
      }
      case "usemtl": {
        material = tokens.join(" ");
        break;
      }
      case "mtllib": {
        mtllibs.push(tokens.join(" "));
        break;
      }
      case undefined:
      default:
        // Normals, groups, smoothing and other statements do not affect voxels.
        break;
    }
  });
  return { positions, uvs, faces, mtllibs };
}

export type ParsedMtl = { name: string; color: Rgb; texture: string | null }[];

export function parseMtl(text: string): ParsedMtl {
  const materials: ParsedMtl = [];
  let current: ParsedMtl[number] | undefined;
  text.split(/\r?\n/u).forEach((rawLine, lineIndex) => {
    const content = rawLine.replace(/#.*$/u, "").trim();
    if (content.length === 0) {
      return;
    }
    const [keyword, ...tokens] = content.split(/\s+/u);
    if (keyword === "newmtl") {
      current = {
        name: tokens.join(" "),
        color: { ...UNMATERIALED.color },
        texture: null,
      };
      materials.push(current);
      return;
    }
    if (current === undefined) {
      return;
    }
    if (keyword === "Kd") {
      const [r = 0, g = 0, b = 0] = numbers(tokens, 3, lineIndex + 1);
      current.color = { r, g, b };
    } else if (keyword === "map_Kd") {
      // Options (-s, -o, …) precede the file name, which is last.
      current.texture = tokens.at(-1) ?? null;
    }
  });
  return materials;
}

async function loadTexture(file: string): Promise<ObjTexture> {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    pixels: new Uint8Array(data),
  };
}

async function loadMaterials(
  dir: string,
  libs: readonly string[],
): Promise<Map<string, ObjMaterial>> {
  const materials = new Map<string, ObjMaterial>();
  for (const lib of libs) {
    const libPath = path.resolve(dir, lib);
    const file = Bun.file(libPath);
    if (!(await file.exists())) {
      throw new Error(
        `OBJ references material library ${lib}, which does not exist at ${libPath}`,
      );
    }
    for (const entry of parseMtl(await file.text())) {
      const texture =
        entry.texture === null
          ? null
          : await loadTexture(
              path.resolve(path.dirname(libPath), entry.texture),
            );
      materials.set(entry.name, {
        name: entry.name,
        color: entry.color,
        texture,
      });
    }
  }
  return materials;
}

function faceMaterial(
  materials: Map<string, ObjMaterial>,
  name: string | null,
): ObjMaterial {
  if (name === null) {
    return UNMATERIALED;
  }
  const found = materials.get(name);
  if (found === undefined) {
    throw new Error(
      `OBJ uses material "${name}", which no material library defines`,
    );
  }
  return found;
}

/** Fan-triangulates one face. */
function triangulate(
  parsed: ParsedObj,
  face: ParsedObj["faces"][number],
  material: ObjMaterial,
): Triangle[] {
  const position = (index: number): Vec3f => {
    const value = parsed.positions[index];
    if (value === undefined) {
      throw new Error(`OBJ vertex ${index.toString()} is undefined`);
    }
    return value;
  };
  const uv = (index: number | null): Vec2f | null =>
    index === null ? null : (parsed.uvs[index] ?? null);
  const [first, ...rest] = face.corners;
  if (first === undefined) {
    return [];
  }
  const triangles: Triangle[] = [];
  for (let index = 0; index + 1 < rest.length; index += 1) {
    const b = rest[index];
    const c = rest[index + 1];
    if (b === undefined || c === undefined) {
      continue;
    }
    const ua = uv(first.vt);
    const ub = uv(b.vt);
    const uc = uv(c.vt);
    triangles.push({
      positions: [position(first.v), position(b.v), position(c.v)],
      uvs: ua === null || ub === null || uc === null ? null : [ua, ub, uc],
      material,
    });
  }
  return triangles;
}

/** Loads an OBJ, its MTL libraries and their textures (paths relative to the OBJ). */
export async function loadMesh(objPath: string): Promise<Mesh> {
  const parsed = parseObj(await Bun.file(objPath).text());
  const materials = await loadMaterials(path.dirname(objPath), parsed.mtllibs);
  const triangles = parsed.faces.flatMap((face) =>
    triangulate(parsed, face, faceMaterial(materials, face.material)),
  );
  if (triangles.length === 0) {
    throw new Error(`${objPath} has no faces`);
  }
  return { triangles };
}

/** Linear-ish sample (nearest texel) of a material at UV, as 0–1 RGB. */
export function sampleMaterial(material: ObjMaterial, uv: Vec2f | null): Rgb {
  if (uv === null || material.texture === null) {
    return material.color;
  }
  const { width, height, pixels } = material.texture;
  const wrap = (value: number): number => value - Math.floor(value);
  const x = Math.min(width - 1, Math.floor(wrap(uv.u) * width));
  // OBJ v grows upward; image rows grow downward.
  const y = Math.min(height - 1, Math.floor((1 - wrap(uv.v)) * height));
  const offset = (y * width + x) * 4;
  return {
    r: (pixels[offset] ?? 0) / 255,
    g: (pixels[offset + 1] ?? 0) / 255,
    b: (pixels[offset + 2] ?? 0) / 255,
  };
}
