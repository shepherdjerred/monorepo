import { z } from "zod";

const layerSchema = z.object({
  data: z.array(z.number()),
  height: z.number(),
  id: z.number(),
  name: z.string(),
  type: z.literal("tilelayer"),
  visible: z.boolean().default(true),
  width: z.number(),
});

const tilesetSchema = z.object({
  columns: z.number(),
  firstgid: z.number(),
  image: z.string(),
  imageheight: z.number(),
  imagewidth: z.number(),
  name: z.string(),
  tilecount: z.number(),
  tileheight: z.number(),
  tilewidth: z.number(),
});

const tiledMapSchema = z.object({
  height: z.number(),
  layers: z.array(layerSchema),
  tileheight: z.number(),
  tilesets: z.array(tilesetSchema),
  tilewidth: z.number(),
  width: z.number(),
});

export type TiledMap = z.infer<typeof tiledMapSchema>;

export async function loadTiledMap(url: string): Promise<TiledMap> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load map ${url}: ${response.statusText}`);
  }
  return tiledMapSchema.parse(await response.json());
}

export function resolveTilesetForGid(map: TiledMap, globalId: number): TiledMap["tilesets"][number] | undefined {
  return map.tilesets.toSorted((left, right) => right.firstgid - left.firstgid).find((tileset) => globalId >= tileset.firstgid);
}

export function textureIdForTileset(tileset: TiledMap["tilesets"][number]): string {
  return tileset.image
    .replace(/^..\//, "")
    .replace(/^tilesets\//, "")
    .replace(/\.png$/, "");
}

export function tileUv(globalId: number, columns: number, firstGid = 1): { column: number; row: number } {
  const index = globalId - firstGid;
  return {
    column: index % columns,
    row: Math.floor(index / columns),
  };
}
