import { z } from "zod";
import championData from "./data-dragon/assets/champion.json" with { type: "json" };
import assetManifestData from "./data-dragon/assets/manifest.json" with { type: "json" };

export const GameAssetKindSchema = z.enum([
  "champion",
  "champion-loading",
  "champion-splash",
  "item",
  "rune",
  "spell",
  "augment",
  "lane",
  "background",
]);
export type GameAssetKind = z.infer<typeof GameAssetKindSchema>;
export const GameAssetManifestEntrySchema = z.object({
  kind: GameAssetKindSchema,
  canonicalId: z.string().min(1),
  mimeType: z.enum(["image/png", "image/jpeg"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  relativePath: z.string().startsWith("img/"),
  sha256: z.string().regex(/^[\da-f]{64}$/),
});
export const GameAssetManifestSchema = z.object({
  version: z.literal(1),
  sourceVersion: z.string().min(1),
  assets: z.array(GameAssetManifestEntrySchema),
});
export type GameAssetManifestEntry = z.infer<
  typeof GameAssetManifestEntrySchema
>;

const ChampionDataSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      id: z.string(),
      key: z.string(),
      name: z.string(),
      modernKey: z.string().optional(),
    }),
  ),
});

export const gameAssetManifest =
  GameAssetManifestSchema.parse(assetManifestData);
const champions = ChampionDataSchema.parse(championData);
const championKeyByLowercase = new Map(
  Object.keys(champions.data).map((key) => [key.toLowerCase(), key]),
);
const championKeyById = new Map(
  Object.entries(champions.data).map(([key, champion]) => [
    Number(champion.key),
    key,
  ]),
);
const championNameByKey = new Map(
  Object.entries(champions.data).map(([key, champion]) => [key, champion.name]),
);
export const browserChampions = Object.entries(champions.data)
  .map(([key, champion]) => ({
    key,
    id: Number(champion.key),
    name: champion.name,
  }))
  .toSorted((left, right) => left.name.localeCompare(right.name));
export const browserModernChampions = browserChampions.filter(
  (champion) => champions.data[champion.key]?.modernKey === undefined,
);
export const browserClassicChampions = browserChampions.filter(
  (champion) => champions.data[champion.key]?.modernKey !== undefined,
);
const assetByIdentity = new Map(
  gameAssetManifest.assets.map((asset) => [
    `${asset.kind}:${asset.canonicalId.toLowerCase()}`,
    asset,
  ]),
);

export function normalizeBrowserChampionKey(value: string | number): string {
  if (typeof value === "number") {
    const key = championKeyById.get(value);
    if (key === undefined) {
      throw new Error(`Unknown champion id ${value.toString()}`);
    }
    return key;
  }
  let decoded = value;
  if (value.includes("%")) {
    try {
      decoded = decodeURIComponent(value);
    } catch (error) {
      if (error instanceof URIError) {
        throw new Error(`Unknown champion key ${value}`, { cause: error });
      }
      throw error;
    }
  }
  const key = championKeyByLowercase.get(decoded.toLowerCase());
  if (key === undefined) {
    throw new Error(`Unknown champion key ${value}`);
  }
  return key;
}

export function getBrowserChampionName(value: string | number): string {
  const key = normalizeBrowserChampionKey(value);
  const name = championNameByKey.get(key);
  if (name === undefined)
    throw new Error(`Champion ${key} has no display name`);
  return name;
}

export function getGameAsset(
  kind: GameAssetKind,
  canonicalKey: string | number,
): GameAssetManifestEntry {
  const rawKey = String(canonicalKey).split("/").at(-1);
  if (rawKey === undefined) {
    throw new Error(`Invalid ${kind} asset key ${String(canonicalKey)}`);
  }
  const extensionIndex = rawKey.lastIndexOf(".");
  const key =
    kind === "champion"
      ? normalizeBrowserChampionKey(canonicalKey)
      : kind === "champion-loading" || kind === "champion-splash"
        ? `${normalizeBrowserChampionKey(canonicalKey)}_0`
        : extensionIndex === -1
          ? rawKey
          : rawKey.slice(0, extensionIndex);
  const asset = assetByIdentity.get(`${kind}:${key.toLowerCase()}`);
  if (asset === undefined) {
    throw new Error(`Unknown ${kind} asset ${String(canonicalKey)}`);
  }
  return asset;
}
