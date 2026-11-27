import type { ReplayInventoryItem } from "@scout-for-lol/replay/types";
import type { z } from "zod";
import { readChampionTracks } from "./scout-terrain-champion-stats.ts";
import {
  currentTerrainClientSliceSha256,
  currentTerrainPositionBuild,
  isExactTerrainReplay,
} from "./tools/research/native-terrain-byte-codecs.mjs";

const inventorySliceSha256 =
  "e4725bce602c14f5999ec83fae12eec239337caf77bdd5efacfe1b6299dec2aa";

export function replayItemAssetSchema(schema: typeof z) {
  return schema
    .object({
      itemId: schema.number().int().positive().max(0xffffffff),
      name: schema.string().min(1).max(240),
      icon: schema.string().regex(/^item-icons\/[1-9]\d{0,9}\.png$/),
      width: schema.number().int().positive().max(512),
      height: schema.number().int().positive().max(512),
    })
    .refine(({ itemId, icon }) => icon === `item-icons/${itemId}.png`);
}

function inventoryTracksSchema(schema: typeof z) {
  const slot = schema
    .object({
      itemId: schema.number().int().positive().max(0xffffffff),
      count: schema.number().int().positive().max(255),
    })
    .nullable();
  return schema.array(
    schema.object({
      participantId: schema.number().int().nonnegative(),
      points: schema
        .array(
          schema.tuple([
            schema.number().nonnegative(),
            schema.array(slot).length(7),
          ]),
        )
        .nonempty()
        .refine((points) => points[0][0] === 0),
    }),
  );
}

export function replayInventorySceneSchema(schema: typeof z) {
  return schema.object({
    items: schema.array(replayItemAssetSchema(schema)),
    tracks: inventoryTracksSchema(schema),
  });
}

type InventoryIdentity = {
  build: string;
  protocol: string;
  replaySha256: string;
  durationMilliseconds: number;
};
type InventoryTracks = z.infer<ReturnType<typeof inventoryTracksSchema>>;
type InventoryScene = z.infer<ReturnType<typeof replayInventorySceneSchema>>;

export function readRecordedInventory(
  schema: typeof z,
  artifact: unknown,
  identity: InventoryIdentity,
  roster: Iterable<number>,
) {
  if (!isExactTerrainReplay(identity, { allowCurrentBuild: true }))
    throw Error("Recorded inventory requires a verified replay build.");
  const sliceSha256 =
    identity.build === currentTerrainPositionBuild
      ? currentTerrainClientSliceSha256
      : inventorySliceSha256;
  const { tracks } = schema
    .object({
      kind: schema.literal("scout-recorded-champion-inventory"),
      build: schema.literal(identity.build),
      protocol: schema.literal(identity.protocol),
      replaySha256: schema.literal(identity.replaySha256),
      sliceSha256: schema.literal(sliceSha256),
      scope: schema.literal("ordinary-stream-with-initial-checkpoint"),
      chronologyAuditSha256: schema.string().regex(/^[0-9a-f]{64}$/),
      verifiedFooterSlots: schema.literal(70),
      tracks: inventoryTracksSchema(schema),
    })
    .parse(artifact);
  readChampionTracks(
    tracks,
    roster,
    identity.durationMilliseconds,
    ({ points }) => [points],
  );
  return tracks;
}

export function itemIdsForTracks(tracks: InventoryTracks) {
  const ids = new Set<number>();
  for (const { points } of tracks) {
    for (const [, slots] of points) {
      for (const slot of slots) {
        if (slot !== null) ids.add(slot.itemId);
      }
    }
  }
  return ids;
}

export type ReplayInventoryPoints = ReadonlyMap<
  number,
  readonly (readonly [number, readonly (ReplayInventoryItem | null)[]])[]
>;

export async function loadRecordedInventory(
  data: InventoryScene | undefined,
  roster: Iterable<number>,
  durationMilliseconds: number,
  imageUrl: (path: string) => Promise<string>,
): Promise<ReplayInventoryPoints | undefined> {
  if (data === undefined) return undefined;
  readChampionTracks(
    data.tracks,
    roster,
    durationMilliseconds,
    ({ points }) => [points],
  );
  const itemIds = itemIdsForTracks(data.tracks);
  for (const { itemId } of data.items) {
    if (!itemIds.delete(itemId))
      throw Error(`Unexpected replay item asset ${itemId}`);
  }
  if (itemIds.size !== 0)
    throw Error("Recorded inventory is missing item assets");
  const assets = new Map(
    await Promise.all(
      data.items.map(
        async ({ itemId, name, icon, width, height }) =>
          [
            itemId,
            { name, width, height, iconUrl: await imageUrl(icon) },
          ] as const,
      ),
    ),
  );
  return new Map(
    data.tracks.map(({ participantId, points }) => [
      participantId,
      points.map(
        ([time, slots]) =>
          [
            time,
            slots.map((slot) => {
              if (slot === null) return null;
              const asset = assets.get(slot.itemId);
              if (asset === undefined)
                throw Error("Verified replay item asset is missing");
              return { ...slot, ...asset };
            }),
          ] as const,
      ),
    ]),
  );
}
