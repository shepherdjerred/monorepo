import path from "node:path";
import { z } from "zod";
import { parseBlockState } from "#src/core/block-state.ts";

/**
 * Resolves block states to cuboid elements using vanilla blockstate and model
 * JSON: variant/multipart selection, parent inheritance, texture variables,
 * element rotation and 90° variant rotations. uvlock is ignored.
 */

const DirectionSchema = z.enum([
  "down",
  "up",
  "north",
  "south",
  "west",
  "east",
]);
export type Direction = z.infer<typeof DirectionSchema>;
export const DIRECTIONS: readonly Direction[] = DirectionSchema.options;

function toDirection(value: string | undefined): Direction | null {
  const parsed = DirectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const Vec3Tuple = z.tuple([z.number(), z.number(), z.number()]);
const FaceSchema = z.object({
  uv: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  texture: z.string(),
  cullface: z.string().optional(),
  rotation: z.number().optional(),
  tintindex: z.number().optional(),
});
const ElementSchema = z.object({
  from: Vec3Tuple,
  to: Vec3Tuple,
  rotation: z
    .object({
      origin: Vec3Tuple,
      axis: z.enum(["x", "y", "z"]),
      angle: z.number(),
      rescale: z.boolean().optional(),
    })
    .optional(),
  shade: z.boolean().optional(),
  faces: z.record(z.string(), FaceSchema),
});
// 26.x allows `{ "sprite": "...", "force_translucent": true }` texture entries.
const TextureRef = z
  .union([z.string(), z.object({ sprite: z.string() })])
  .transform((value) => (typeof value === "string" ? value : value.sprite));
const ModelSchema = z.object({
  parent: z.string().optional(),
  textures: z.record(z.string(), TextureRef).optional(),
  elements: z.array(ElementSchema).optional(),
});
const ApplySchema = z.object({
  model: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  uvlock: z.boolean().optional(),
});
const ApplyOrList = z.union([ApplySchema, z.array(ApplySchema)]);
type Condition = Record<string, unknown>;
const BlockstateSchema = z.object({
  variants: z.record(z.string(), ApplyOrList).optional(),
  multipart: z
    .array(
      z.object({
        apply: ApplyOrList,
        when: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});

export type ResolvedFace = {
  uv: [number, number, number, number];
  /** Texture path relative to textures/, e.g. "block/oak_planks". */
  texture: string;
  cullface: Direction | null;
  rotation: number;
  tinted: boolean;
};
export type ResolvedElement = {
  from: [number, number, number];
  to: [number, number, number];
  rotation: z.infer<typeof ElementSchema>["rotation"];
  shade: boolean;
  faces: Partial<Record<Direction, ResolvedFace>>;
};
export type ResolvedModel = {
  elements: ResolvedElement[];
  /** Particle texture, used to approximate entity-rendered blocks. */
  particle: string | null;
};
export type AppliedModel = { model: ResolvedModel; x: number; y: number };

function stripNamespace(name: string): string {
  return name.replace(/^minecraft:/u, "");
}

function defaultUv(
  direction: Direction,
  from: readonly number[],
  to: readonly number[],
): [number, number, number, number] {
  const [x1 = 0, y1 = 0, z1 = 0] = from;
  const [x2 = 16, y2 = 16, z2 = 16] = to;
  switch (direction) {
    case "down": {
      return [x1, 16 - z2, x2, 16 - z1];
    }
    case "up": {
      return [x1, z1, x2, z2];
    }
    case "north": {
      return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
    }
    case "south": {
      return [x1, 16 - y2, x2, 16 - y1];
    }
    case "west": {
      return [z1, 16 - y2, z2, 16 - y1];
    }
    case "east": {
      return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
    }
  }
}

function matches(
  when: Condition,
  properties: Readonly<Record<string, string>>,
): boolean {
  const or = when["OR"];
  if (Array.isArray(or)) {
    return or.some((entry: Condition) => matches(entry, properties));
  }
  const and = when["AND"];
  if (Array.isArray(and)) {
    return and.every((entry: Condition) => matches(entry, properties));
  }
  return Object.entries(when).every(([key, expected]) => {
    const actual = properties[key];
    return actual !== undefined && String(expected).split("|").includes(actual);
  });
}

function firstApply(
  value: z.infer<typeof ApplyOrList>,
): z.infer<typeof ApplySchema> | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** First matching variant (deterministic: weights ignored) plus every matching multipart. */
function chooseModels(
  blockstate: z.infer<typeof BlockstateSchema>,
  properties: Readonly<Record<string, string>>,
): z.infer<typeof ApplySchema>[] {
  const chosen: z.infer<typeof ApplySchema>[] = [];
  const variant = Object.entries(blockstate.variants ?? {}).find(([key]) =>
    variantMatches(key, properties),
  );
  const fromVariant =
    variant === undefined ? undefined : firstApply(variant[1]);
  if (fromVariant !== undefined) {
    chosen.push(fromVariant);
  }
  for (const part of blockstate.multipart ?? []) {
    const apply =
      part.when === undefined || matches(part.when, properties)
        ? firstApply(part.apply)
        : undefined;
    if (apply !== undefined) {
      chosen.push(apply);
    }
  }
  return chosen;
}

function variantMatches(
  key: string,
  properties: Readonly<Record<string, string>>,
): boolean {
  if (key === "") {
    return true;
  }
  return key.split(",").every((pair) => {
    const [name = "", value = ""] = pair.split("=");
    return properties[name] === value;
  });
}

export class ModelResolver {
  private readonly models = new Map<string, z.infer<typeof ModelSchema>>();
  private readonly resolved = new Map<string, ResolvedModel>();
  private readonly states = new Map<string, AppliedModel[]>();

  /** `root` contains assets/minecraft/{blockstates,models,textures}. */
  constructor(readonly root: string) {}

  private file(...parts: string[]): string {
    return path.join(this.root, "assets", "minecraft", ...parts);
  }

  private async rawModel(name: string): Promise<z.infer<typeof ModelSchema>> {
    const key = stripNamespace(name);
    let model = this.models.get(key);
    if (model === undefined) {
      const file = Bun.file(this.file("models", `${key}.json`));
      model = ModelSchema.parse(await file.json());
      this.models.set(key, model);
    }
    return model;
  }

  async model(name: string): Promise<ResolvedModel> {
    const key = stripNamespace(name);
    const cached = this.resolved.get(key);
    if (cached !== undefined) {
      return cached;
    }
    // Walk the parent chain; children override textures and elements.
    const chain: z.infer<typeof ModelSchema>[] = [];
    let current: string | undefined = key;
    while (current !== undefined && !current.startsWith("builtin/")) {
      const raw = await this.rawModel(current);
      chain.push(raw);
      current =
        raw.parent === undefined ? undefined : stripNamespace(raw.parent);
    }
    const textures: Record<string, string> = {};
    let elements: z.infer<typeof ElementSchema>[] | undefined;
    for (const raw of chain.toReversed()) {
      Object.assign(textures, raw.textures ?? {});
      if (raw.elements !== undefined) {
        elements = raw.elements;
      }
    }
    const lookup = (ref: string): string | null => {
      let value: string | undefined = ref;
      for (
        let depth = 0;
        depth < 16 && value?.startsWith("#") === true;
        depth += 1
      ) {
        value = textures[value.slice(1)];
      }
      return value === undefined || value.startsWith("#")
        ? null
        : stripNamespace(value);
    };
    const resolvedElements: ResolvedElement[] = (elements ?? []).map(
      (element) => {
        const faces: Partial<Record<Direction, ResolvedFace>> = {};
        for (const [faceName, face] of Object.entries(element.faces)) {
          const direction = toDirection(faceName);
          const texture = lookup(face.texture);
          if (direction !== null && texture !== null) {
            faces[direction] = {
              uv: face.uv ?? defaultUv(direction, element.from, element.to),
              texture,
              cullface: toDirection(face.cullface),
              rotation: face.rotation ?? 0,
              tinted: face.tintindex !== undefined,
            };
          }
        }
        return {
          from: element.from,
          to: element.to,
          rotation: element.rotation,
          shade: element.shade ?? true,
          faces,
        };
      },
    );
    const resolved = {
      elements: resolvedElements,
      particle: lookup("#particle"),
    };
    this.resolved.set(key, resolved);
    return resolved;
  }

  /** Models (with variant rotation) that make up a block state. */
  async forState(state: string): Promise<AppliedModel[]> {
    const cached = this.states.get(state);
    if (cached !== undefined) {
      return cached;
    }
    const parsed = parseBlockState(state);
    const file = Bun.file(
      this.file("blockstates", `${stripNamespace(parsed.id)}.json`),
    );
    const chosen = chooseModels(
      BlockstateSchema.parse(await file.json()),
      parsed.properties,
    );
    const applied: AppliedModel[] = [];
    for (const apply of chosen) {
      applied.push({
        model: await this.model(apply.model),
        x: apply.x ?? 0,
        y: apply.y ?? 0,
      });
    }
    this.states.set(state, applied);
    return applied;
  }
}
