import type { z } from "zod/v4";
import {
  GuildInventorySchema,
  GuildSnapshotSchema,
  type MirroredObject,
} from "#shared/glitter-corpus.ts";
import { compareSnowflakes } from "#shared/glitter-corpus-projection.ts";
import {
  glitterCorpusLastSnapshotTimestampSeconds,
  glitterCorpusSnapshotMessages,
} from "#observability/metrics.ts";
import {
  DailyBaselineSchema,
  FinalizeSnapshotInputSchema,
  type DailyBaseline,
} from "./glitter-corpus-activity-types.ts";
import {
  glitterCorpusRuntimeConfig,
  jsonBytes,
  loadStateManifest,
} from "./glitter-corpus-io.ts";
import {
  createCorpusStoresFromEnv,
  LatestSnapshotPointerSchema,
  publishLatestSnapshotPointer,
  putMirroredImmutableObject,
  readMirroredObject,
  readVerifiedMirroredObject,
} from "./glitter-corpus-storage.ts";

export async function finalizeGlitterCorpusSnapshot(
  rawInput: z.input<typeof FinalizeSnapshotInputSchema>,
) {
  const input = FinalizeSnapshotInputSchema.parse(rawInput);
  const snapshot = GuildSnapshotSchema.parse({
    schemaVersion: 1,
    snapshotId: input.snapshotId,
    guildId: input.guildId,
    createdAt: input.createdAt,
    inventoryObject: input.inventoryObject,
    channelManifestObjects: input.channelStates.map(
      (state) => state.manifestObject,
    ),
    expectedChannelIds: input.expectedChannelIds.toSorted(compareSnowflakes),
    completeChannelIds: input.channelStates
      .map((state) => state.channelId)
      .toSorted(compareSnowflakes),
    uniqueMessageCount: input.channelStates.reduce(
      (total, state) => total + state.uniqueMessageCount,
      0,
    ),
    complete: true,
  });
  const stores = createCorpusStoresFromEnv();
  const snapshotKey = `guilds/${input.guildId}/snapshots/${input.snapshotId}.json`;
  const snapshotObject = await putMirroredImmutableObject({
    stores,
    key: snapshotKey,
    body: jsonBytes(snapshot),
    contentType: "application/json",
    writtenAt: input.createdAt,
  });
  await publishLatestSnapshotPointer({
    stores,
    pointer: {
      schemaVersion: 1,
      guildId: input.guildId,
      snapshotId: input.snapshotId,
      snapshotKey,
      snapshotSha256: snapshotObject.sha256,
      publishedAt: input.createdAt,
    },
  });
  glitterCorpusSnapshotMessages.set(snapshot.uniqueMessageCount);
  glitterCorpusLastSnapshotTimestampSeconds.set(
    Date.parse(input.createdAt) / 1000,
  );
  return { snapshot, snapshotKey, snapshotObject };
}

export async function loadGlitterCorpusDailyBaseline(): Promise<DailyBaseline> {
  const config = glitterCorpusRuntimeConfig();
  const stores = createCorpusStoresFromEnv();
  const pointerKey = `guilds/${config.guildId}/snapshots/latest.json`;
  const pointerBytes = await readMirroredObject({ stores, key: pointerKey });
  if (pointerBytes === undefined) {
    throw new Error(
      `daily capture has no verified baseline snapshot: ${pointerKey}`,
    );
  }
  const pointer = LatestSnapshotPointerSchema.parse(
    JSON.parse(new TextDecoder().decode(pointerBytes)),
  );
  const snapshotBytes = await readVerifiedMirroredObject({
    stores,
    key: pointer.snapshotKey,
    expectedSha256: pointer.snapshotSha256,
  });
  const snapshot = GuildSnapshotSchema.parse(
    JSON.parse(new TextDecoder().decode(snapshotBytes)),
  );
  const inventoryBytes = await readVerifiedMirroredObject({
    stores,
    key: snapshot.inventoryObject.key,
    expectedSha256: snapshot.inventoryObject.sha256,
  });
  const inventory = GuildInventorySchema.parse(
    JSON.parse(new TextDecoder().decode(inventoryBytes)),
  );
  const states: Record<
    string,
    {
      manifestKey: string;
      manifestObject: MirroredObject;
      uniqueMessageCount: number;
      newestMessageId: string | null;
    }
  > = {};
  for (const object of snapshot.channelManifestObjects) {
    const manifest = await loadStateManifest(object.key);
    states[manifest.channelId] = {
      manifestKey: object.key,
      manifestObject: object,
      uniqueMessageCount: manifest.uniqueMessageCount,
      newestMessageId: manifest.newestMessageId,
    };
  }
  return DailyBaselineSchema.parse({
    inventory,
    inventoryObject: snapshot.inventoryObject,
    states,
  });
}
