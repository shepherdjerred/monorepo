import type { z } from "zod/v4";
import {
  GuildInventorySchema,
  GuildSnapshotSchema,
} from "#shared/glitter-corpus.ts";
import { compareSnowflakes } from "#shared/glitter-corpus-projection.ts";
import {
  glitterCorpusLastSnapshotTimestampSeconds,
  glitterCorpusSnapshotMetricsConfigured,
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
import { createCorpusStoreFromEnv } from "./glitter-corpus-store.ts";
import {
  LatestSnapshotPointerSchema,
  publishLatestSnapshotPointer,
  putImmutableObject,
  readObject,
  readRequiredObject,
  readVerifiedObject,
} from "./glitter-corpus-storage.ts";
import { verifyGlitterCorpusSnapshotGraph } from "./glitter-corpus-recovery.ts";

const SNAPSHOT_METRICS_ENVIRONMENT = [
  "GLITTER_DISCORD_GUILD_ID",
  "GLITTER_CORPUS_S3_ENDPOINT",
  "GLITTER_CORPUS_S3_BUCKET",
  "GLITTER_CORPUS_S3_ACCESS_KEY_ID",
  "GLITTER_CORPUS_S3_SECRET_ACCESS_KEY",
] as const;

export async function restoreGlitterCorpusSnapshotMetrics(): Promise<void> {
  const configured = SNAPSHOT_METRICS_ENVIRONMENT.every((name) => {
    const value = Bun.env[name];
    return value !== undefined && value !== "";
  });
  glitterCorpusSnapshotMetricsConfigured.set(configured ? 1 : 0);
  if (!configured) {
    return;
  }
  const guildId = Bun.env["GLITTER_DISCORD_GUILD_ID"];
  if (guildId === undefined || guildId === "") {
    throw new Error("configured Glitter corpus metrics have no guild ID");
  }
  const store = createCorpusStoreFromEnv();
  const pointerKey = `guilds/${guildId}/snapshots/latest.json`;
  const pointerBytes = await readObject({ store, key: pointerKey });
  if (pointerBytes === undefined) {
    return;
  }
  const pointer = LatestSnapshotPointerSchema.parse(
    JSON.parse(new TextDecoder().decode(pointerBytes)),
  );
  if (pointer.guildId !== guildId) {
    throw new Error(`latest corpus pointer belongs to ${pointer.guildId}`);
  }
  const snapshotBytes = await readVerifiedObject({
    store,
    key: pointer.snapshotKey,
    expectedSha256: pointer.snapshotSha256,
  });
  const snapshot = GuildSnapshotSchema.parse(
    JSON.parse(new TextDecoder().decode(snapshotBytes)),
  );
  glitterCorpusSnapshotMessages.set(snapshot.uniqueMessageCount);
  glitterCorpusLastSnapshotTimestampSeconds.set(
    Date.parse(snapshot.createdAt) / 1000,
  );
}

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
  const store = createCorpusStoreFromEnv();
  const inventoryBytes = await readVerifiedObject({
    store,
    key: snapshot.inventoryObject.key,
    expectedSha256: snapshot.inventoryObject.sha256,
  });
  const inventory = GuildInventorySchema.parse(
    JSON.parse(new TextDecoder().decode(inventoryBytes)),
  );
  if (inventory.guildId !== snapshot.guildId) {
    throw new Error("snapshot inventory belongs to a different guild");
  }
  await verifyGlitterCorpusSnapshotGraph({
    snapshot,
    guildSlug: inventory.guildSlug,
  });
  const snapshotKey = `guilds/${input.guildId}/snapshots/${input.snapshotId}.json`;
  const snapshotObject = await putImmutableObject({
    store,
    key: snapshotKey,
    body: jsonBytes(snapshot),
    contentType: "application/json",
    writtenAt: input.createdAt,
  });
  await publishLatestSnapshotPointer({
    store,
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
  const store = createCorpusStoreFromEnv();
  const pointerKey = `guilds/${config.guildId}/snapshots/latest.json`;
  const pointerBytes = await readRequiredObject({ store, key: pointerKey });
  const pointer = LatestSnapshotPointerSchema.parse(
    JSON.parse(new TextDecoder().decode(pointerBytes)),
  );
  const snapshotBytes = await readVerifiedObject({
    store,
    key: pointer.snapshotKey,
    expectedSha256: pointer.snapshotSha256,
  });
  const snapshot = GuildSnapshotSchema.parse(
    JSON.parse(new TextDecoder().decode(snapshotBytes)),
  );
  const inventoryBytes = await readVerifiedObject({
    store,
    key: snapshot.inventoryObject.key,
    expectedSha256: snapshot.inventoryObject.sha256,
  });
  const inventory = GuildInventorySchema.parse(
    JSON.parse(new TextDecoder().decode(inventoryBytes)),
  );
  const states: DailyBaseline["states"] = {};
  for (const object of snapshot.channelManifestObjects) {
    const manifest = await loadStateManifest(object.key);
    states[manifest.channelId] = {
      manifestKey: object.key,
      manifestObject: object,
      uniqueMessageCount: manifest.uniqueMessageCount,
      newestMessageId: manifest.newestMessageId,
      lineageDepth: manifest.lineageDepth,
      seedPrefix: manifest.seedPrefix,
    };
  }
  return DailyBaselineSchema.parse({
    inventory,
    inventoryObject: snapshot.inventoryObject,
    states,
  });
}
