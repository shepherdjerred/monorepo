import { z } from "zod";

const coordinate = z
  .string()
  .transform((value) =>
    z
      .tuple([
        z.coerce.number().int(),
        z.coerce.number().int(),
        z.coerce.number().int(),
      ])
      .parse(value.split(",")),
  );
const color = z.enum(["RED", "BLUE", "GREEN", "PURPLE", "YELLOW"]);
const legacy = z.strictObject({
  Name: z.string().min(1),
  Author: z.string().min(1),
  Description: z.string(),
  Border: z.tuple([coordinate, coordinate]),
  Teams: z.partialRecord(
    color,
    z.strictObject({ Spawns: z.array(coordinate).min(1) }),
  ),
  Custom: z.record(
    z.string(),
    z.union([z.array(coordinate), z.tuple([z.boolean()])]),
  ),
});

export function legacyMap(text: string) {
  const source = legacy.parse(Bun.YAML.parse(text));
  const [first, second] = source.Border;
  const bounds = {
    minX: Math.min(first[0], second[0]),
    maxX: Math.max(first[0], second[0]),
    minZ: Math.min(first[2], second[2]),
    maxZ: Math.max(first[2], second[2]),
  };
  const teams = Object.entries(source.Teams).map(([team, definition]) => ({
    color: color.parse(team),
    spawns: definition.Spawns,
    bombs: z
      .array(z.tuple([z.number().int(), z.number().int(), z.number().int()]))
      .min(1)
      .parse(source.Custom[`${team} Bombs`]),
  }));
  if (teams.length < 2) throw new Error("Map requires at least two teams");
  for (const key of Object.keys(source.Custom)) {
    if (
      key !== "Random Base" &&
      !teams.some((team) => key === `${team.color} Bombs`)
    )
      throw new Error(`Unsupported legacy setting: ${key}`);
  }
  const points = teams.flatMap((team) => [...team.spawns, ...team.bombs]);
  for (const [x, y, south] of points) {
    if (
      x < bounds.minX ||
      x > bounds.maxX ||
      south < bounds.minZ ||
      south > bounds.maxZ ||
      y < 0 ||
      y > 252
    )
      throw new Error(
        `Original spawn/objective outside export bounds: ${[x, y, south].join(",")}`,
      );
  }
  return {
    source,
    bounds,
    teams,
    requiredY: Math.max(...points.map((point) => point[1])),
  };
}

export function mapId(filename: string) {
  return z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/u)
    .parse(
      filename
        .replace(/\.zip$/u, "")
        .replaceAll(/([a-z])([A-Z])/gu, "$1-$2")
        .replaceAll(/[^a-zA-Z0-9]+/gu, "-")
        .toLowerCase(),
    );
}

export const ExportState = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("idle") }),
  z.strictObject({ state: z.literal("reading") }),
  z.strictObject({ state: z.literal("encoding") }),
  z.strictObject({ state: z.literal("failed"), message: z.string() }),
  z.strictObject({
    state: z.literal("complete"),
    minY: z.number().int(),
    maxY: z.number().int(),
    removedData: z.number().int().nonnegative(),
    blocksSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
]);

export const RemovedData = z.array(
  z.strictObject({
    kind: z.enum(["block-entity", "entity"]),
    type: z.string().regex(/^minecraft:[a-z0-9_]+$/u),
    x: z.number().int(),
    y: z.number().int(),
    z: z.number().int(),
  }),
);

export function mapContent(
  id: string,
  index: number,
  map: ReturnType<typeof legacyMap>,
  terrain: Extract<z.infer<typeof ExportState>, { state: "complete" }>,
) {
  const dx = 1024 + (index % 6) * 1024 - map.bounds.minX;
  const dz = 1024 + Math.floor(index / 6) * 1024 - map.bounds.minZ;
  const centerX = (map.bounds.minX + map.bounds.maxX) / 2;
  const centerZ = (map.bounds.minZ + map.bounds.maxZ) / 2;
  const point = ([x, y, south]: readonly [number, number, number]) => ({
    x: x + dx + 0.5,
    y,
    z: south + dz + 0.5,
    yaw:
      ((Math.atan2(centerZ - south, centerX - x) * 180) / Math.PI + 270) % 360,
    pitch: 0,
  });
  return {
    id,
    name: map.source.Name,
    author: map.source.Author,
    region: {
      min: {
        x: map.bounds.minX + dx,
        y: terrain.minY,
        z: map.bounds.minZ + dz,
      },
      max: {
        x: map.bounds.maxX + dx,
        y: terrain.maxY,
        z: map.bounds.maxZ + dz,
      },
    },
    spectator: {
      x: centerX + dx + 0.5,
      y: terrain.maxY,
      z: centerZ + dz + 0.5,
      yaw: 0,
      pitch: 45,
    },
    teams: map.teams.map((team) => ({
      color: team.color,
      spawns: team.spawns.map((spawn) => point(spawn)),
    })),
    bombs: map.teams.flatMap((team) =>
      team.bombs.map(([x, y, south], bomb) => ({
        id: `${team.color.toLowerCase()}-${(bomb + 1).toString()}`,
        team: team.color,
        at: { x: x + dx, y, z: south + dz },
      })),
    ),
    nukes: [],
    blocksSha256: terrain.blocksSha256,
  };
}
