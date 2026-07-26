import { Context } from "@temporalio/activity";
import type { z } from "zod/v4";
import {
  ChannelCompletenessManifestSchema,
  ChannelOverlapManifestSchema,
  CurrentMessageSchema,
  GuildInventorySchema,
  PageManifestSchema,
} from "#shared/glitter-corpus.ts";
import {
  buildCurrentProjection,
  compareSnowflakes,
  mergeCurrentProjection,
  serializeProjection,
  sha256,
} from "#shared/glitter-corpus-projection.ts";
import {
  glitterCorpusInventoryEntries,
  glitterCorpusInventoryScopeChanges,
  glitterCorpusMessagesObservedTotal,
  glitterCorpusPagesTotal,
} from "#observability/metrics.ts";
import {
  ApplyOverlapInputSchema,
  CapturePageInputSchema,
  CapturePageResultSchema,
  InventoryResultSchema,
  VerifyChannelInputSchema,
  type CapturePageInput,
  type CapturePageResult,
  type ChannelStateResult,
  type InventoryResult,
} from "./glitter-corpus-activity-types.ts";
import {
  DiscordRestClient,
  discoverGuildInventory,
} from "./glitter-corpus-discord.ts";
import {
  glitterCorpusRuntimeConfig,
  jsonBytes,
  loadStateManifest,
  readCorpusJson,
  readOverlapTraversal,
  readSeedChannelObservations,
  readTraversal,
  writeChannelProjection,
} from "./glitter-corpus-io.ts";
import {
  finalizeGlitterCorpusSnapshot,
  loadGlitterCorpusDailyBaseline,
} from "./glitter-corpus-snapshot.ts";
import {
  createCorpusStoresFromEnv,
  putMirroredImmutableObject,
  readMirroredObject,
} from "./glitter-corpus-storage.ts";
import {
  persistProjectionState,
  projectionStateFields,
} from "./glitter-corpus-state.ts";

async function inventoryGlitterGuild(input: {
  discoveredAt: string;
  baselineInventory?: z.input<typeof GuildInventorySchema>;
}): Promise<InventoryResult> {
  const config = glitterCorpusRuntimeConfig();
  const inventory = await discoverGuildInventory({
    token: config.token,
    guildId: config.guildId,
    guildSlug: config.guildSlug,
    denylistedChannelIds: config.denylistedChannelIds,
    discoveredAt: input.discoveredAt,
  });
  glitterCorpusInventoryEntries.reset();
  for (const entry of inventory.entries) {
    glitterCorpusInventoryEntries.inc({
      decision: entry.scopeDecision,
    });
  }
  glitterCorpusInventoryScopeChanges.reset();
  if (input.baselineInventory !== undefined) {
    const baseline = GuildInventorySchema.parse(input.baselineInventory);
    const previousById = new Map(
      baseline.entries.map((entry) => [entry.channelId, entry.scopeDecision]),
    );
    const currentIds = new Set<string>();
    for (const entry of inventory.entries) {
      currentIds.add(entry.channelId);
      const previous = previousById.get(entry.channelId);
      if (previous === undefined) {
        glitterCorpusInventoryScopeChanges.inc({ change: "added" });
      } else if (previous !== entry.scopeDecision) {
        glitterCorpusInventoryScopeChanges.inc({
          change: "scope-decision-changed",
        });
      }
    }
    for (const entry of baseline.entries) {
      if (!currentIds.has(entry.channelId)) {
        glitterCorpusInventoryScopeChanges.inc({ change: "removed" });
      }
    }
  }
  const inventoryKey = `guilds/${config.guildId}/inventory/${inventory.sha256}.json`;
  const inventoryObject = await putMirroredImmutableObject({
    stores: createCorpusStoresFromEnv(),
    key: inventoryKey,
    body: jsonBytes(inventory),
    contentType: "application/json",
    writtenAt: input.discoveredAt,
  });
  return InventoryResultSchema.parse({
    inventory,
    inventoryKey,
    inventoryObject,
  });
}

async function loadApprovedGlitterInventory(input: {
  inventoryKey: string;
  expectedSha256: string;
}): Promise<InventoryResult> {
  const inventory = await readCorpusJson(
    input.inventoryKey,
    GuildInventorySchema,
  );
  const calculatedChecksum = sha256(
    JSON.stringify({
      schemaVersion: inventory.schemaVersion,
      guildId: inventory.guildId,
      guildSlug: inventory.guildSlug,
      guildName: inventory.guildName,
      discoveredAt: inventory.discoveredAt,
      denylistedChannelIds: inventory.denylistedChannelIds,
      entries: inventory.entries,
    }),
  );
  if (
    inventory.sha256 !== input.expectedSha256 ||
    calculatedChecksum !== input.expectedSha256
  ) {
    throw new Error(
      `inventory approval checksum does not match ${input.inventoryKey}`,
    );
  }
  const bytes = await readMirroredObject({
    stores: createCorpusStoresFromEnv(),
    key: input.inventoryKey,
  });
  if (bytes === undefined) {
    throw new Error(`approved inventory is missing: ${input.inventoryKey}`);
  }
  const inventoryObject = await putMirroredImmutableObject({
    stores: createCorpusStoresFromEnv(),
    key: input.inventoryKey,
    body: bytes,
    contentType: "application/json",
    writtenAt: inventory.discoveredAt,
  });
  return InventoryResultSchema.parse({
    inventory,
    inventoryKey: input.inventoryKey,
    inventoryObject,
  });
}

async function captureGlitterCorpusPage(
  rawInput: CapturePageInput,
): Promise<CapturePageResult> {
  const input = CapturePageInputSchema.parse(rawInput);
  const config = glitterCorpusRuntimeConfig();
  if (config.guildId !== input.guildId) {
    throw new Error(
      `configured guild ${config.guildId} does not match workflow guild ${input.guildId}`,
    );
  }
  Context.current().heartbeat({
    phase: "discord-request",
    channelId: input.channelId,
    direction: input.direction,
  });
  const page = await new DiscordRestClient(config.token).getMessages({
    channelId: input.channelId,
    ...(input.before === undefined ? {} : { before: input.before }),
    ...(input.after === undefined ? {} : { after: input.after }),
  });
  const rawBody = new TextEncoder().encode(page.rawBody);
  const rawObjectKey =
    `guilds/${input.guildId}/channels/${input.channelId}/raw/` +
    `${input.direction}/${input.requestId}.json`;
  const stores = createCorpusStoresFromEnv();
  await putMirroredImmutableObject({
    stores,
    key: rawObjectKey,
    body: rawBody,
    contentType: "application/json",
    writtenAt: page.completedAt,
  });

  const manifest = PageManifestSchema.parse({
    schemaVersion: 1,
    requestId: input.requestId,
    guildId: input.guildId,
    channelId: input.channelId,
    direction: input.direction,
    before: input.before ?? null,
    after: input.after ?? null,
    requestedAt: page.requestedAt,
    completedAt: page.completedAt,
    responseCount: page.data.length,
    firstMessageId: page.data[0]?.id ?? null,
    lastMessageId: page.data.at(-1)?.id ?? null,
    rawObjectKey,
    rawSha256: sha256(rawBody),
    retryCount: page.retryCount,
    rateLimit: page.rateLimit,
  });
  const manifestKey =
    `guilds/${input.guildId}/channels/${input.channelId}/pages/` +
    `${input.direction}/${input.requestId}.json`;
  const manifestObject = await putMirroredImmutableObject({
    stores,
    key: manifestKey,
    body: jsonBytes(manifest),
    contentType: "application/json",
    writtenAt: page.completedAt,
  });
  glitterCorpusPagesTotal.inc({ direction: input.direction });
  glitterCorpusMessagesObservedTotal.inc(
    { direction: input.direction },
    page.data.length,
  );
  return CapturePageResultSchema.parse({
    manifestKey,
    manifestObject,
    page: manifest,
    messageIds: page.data.map((message) => message.id),
    messageTimestamps: page.data.map((message) => message.timestamp),
  });
}

async function verifyGlitterCorpusChannel(
  rawInput: z.input<typeof VerifyChannelInputSchema>,
): Promise<ChannelStateResult> {
  const input = VerifyChannelInputSchema.parse(rawInput);
  const backward = await readTraversal({
    guildId: input.guildId,
    guildSlug: input.guildSlug,
    channelId: input.channelId,
    direction: "backward",
    pageManifestKeys: input.backwardPageManifestKeys,
  });
  Context.current().heartbeat({
    phase: "verify-forward",
    channelId: input.channelId,
  });
  const oldestBackwardMessageId =
    backward.messageIds.toSorted(compareSnowflakes)[0];
  if (oldestBackwardMessageId === "0") {
    throw new Error("Discord snowflake cannot be zero");
  }
  const forward = await readTraversal({
    guildId: input.guildId,
    guildSlug: input.guildSlug,
    channelId: input.channelId,
    direction: "forward",
    ...(oldestBackwardMessageId === undefined
      ? {}
      : {
          initialAfter: String(BigInt(oldestBackwardMessageId) - 1n),
        }),
    pageManifestKeys: input.forwardPageManifestKeys,
  });
  const backwardIds = backward.messageIds.toSorted(compareSnowflakes);
  const forwardIds = forward.messageIds.toSorted(compareSnowflakes);
  if (JSON.stringify(backwardIds) !== JSON.stringify(forwardIds)) {
    throw new Error(
      `independent traversal mismatch for channel ${input.channelId}: backward=${String(backwardIds.length)} forward=${String(forwardIds.length)}`,
    );
  }

  const observations = [
    ...backward.observations,
    ...(await readSeedChannelObservations({
      seedPrefix: input.seedPrefix,
      channelId: input.channelId,
    })),
  ];
  const projection = buildCurrentProjection(observations);
  const projectionObject = await writeChannelProjection({
    guildId: input.guildId,
    channelId: input.channelId,
    snapshotId: input.snapshotId,
    projectionNdjson: serializeProjection(projection),
    writtenAt: input.verifiedAt,
  });
  const manifest = ChannelCompletenessManifestSchema.parse({
    schemaVersion: 1,
    snapshotId: input.snapshotId,
    guildId: input.guildId,
    channelId: input.channelId,
    verifiedAt: input.verifiedAt,
    backwardProof: {
      direction: "backward",
      pageManifestKeys: input.backwardPageManifestKeys,
      terminalPageManifestKey: input.backwardPageManifestKeys.at(-1),
      terminalResponseCount: backward.terminal.responseCount,
    },
    forwardProof: {
      direction: "forward",
      pageManifestKeys: input.forwardPageManifestKeys,
      terminalPageManifestKey: input.forwardPageManifestKeys.at(-1),
      terminalResponseCount: forward.terminal.responseCount,
    },
    observationCount: observations.length,
    seedPrefix: input.seedPrefix ?? null,
    seedObservationCount: observations.length - backward.observations.length,
    duplicateObservationCount: observations.length - projection.length,
    ...projectionStateFields({
      projection,
      projectionObjectKey: projectionObject.key,
    }),
  });
  return await persistProjectionState({
    identity: input,
    manifest,
    projection,
  });
}

async function readBaselineProjection(input: {
  manifestKey: string;
  guildId: string;
  channelId: string;
}) {
  const baseline = await loadStateManifest(input.manifestKey);
  if (
    baseline.guildId !== input.guildId ||
    baseline.channelId !== input.channelId
  ) {
    throw new Error(`baseline state identity mismatch for ${input.channelId}`);
  }
  const bytes = await readMirroredObject({
    stores: createCorpusStoresFromEnv(),
    key: baseline.projectionObjectKey,
  });
  if (bytes === undefined) {
    throw new Error(
      `baseline projection missing: ${baseline.projectionObjectKey}`,
    );
  }
  if (sha256(bytes) !== baseline.projectionSha256) {
    throw new Error(
      `baseline projection checksum mismatch: ${baseline.projectionObjectKey}`,
    );
  }
  const messages = new TextDecoder()
    .decode(bytes)
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => CurrentMessageSchema.parse(JSON.parse(line)));
  return { baseline, messages };
}

async function applyGlitterCorpusOverlap(
  rawInput: z.input<typeof ApplyOverlapInputSchema>,
): Promise<ChannelStateResult> {
  const input = ApplyOverlapInputSchema.parse(rawInput);
  const { baseline, messages: existing } = await readBaselineProjection({
    manifestKey: input.baselineManifestKey,
    guildId: input.guildId,
    channelId: input.channelId,
  });
  if (baseline.newestMessageId !== input.baselineNewestMessageId) {
    throw new Error(
      `baseline newest-message boundary mismatch for ${input.channelId}`,
    );
  }
  const { observations, messageIds, timestamps, terminal } =
    await readOverlapTraversal({
      guildId: input.guildId,
      guildSlug: input.guildSlug,
      channelId: input.channelId,
      pageManifestKeys: input.pageManifestKeys,
    });
  if (
    input.stoppedBecause === "empty-channel" &&
    terminal.responseCount !== 0
  ) {
    throw new Error(
      `daily overlap for ${input.channelId} claims an empty terminal page`,
    );
  }
  const oldestObservedMessageId =
    messageIds.toSorted(compareSnowflakes)[0] ?? null;
  const projection = mergeCurrentProjection(existing, observations);
  const projectionObject = await writeChannelProjection({
    guildId: input.guildId,
    channelId: input.channelId,
    snapshotId: input.snapshotId,
    projectionNdjson: serializeProjection(projection),
    writtenAt: input.verifiedAt,
  });
  const manifest = ChannelOverlapManifestSchema.parse({
    schemaVersion: 1,
    snapshotId: input.snapshotId,
    guildId: input.guildId,
    channelId: input.channelId,
    verifiedAt: input.verifiedAt,
    baselineManifestKey: input.baselineManifestKey,
    overlapPageManifestKeys: input.pageManifestKeys,
    overlapCutoff: input.overlapCutoff,
    baselineNewestMessageId: input.baselineNewestMessageId,
    oldestObservedTimestamp: timestamps.toSorted()[0] ?? null,
    oldestObservedMessageId,
    stoppedBecause: input.stoppedBecause,
    observationCount: observations.length,
    ...projectionStateFields({
      projection,
      projectionObjectKey: projectionObject.key,
    }),
  });
  return await persistProjectionState({
    identity: input,
    manifest,
    projection,
  });
}

export const glitterCorpusActivities = {
  inventoryGlitterGuild,
  loadApprovedGlitterInventory,
  captureGlitterCorpusPage,
  verifyGlitterCorpusChannel,
  applyGlitterCorpusOverlap,
  finalizeGlitterCorpusSnapshot,
  loadGlitterCorpusDailyBaseline,
};
