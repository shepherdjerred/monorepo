import { Context } from "@temporalio/activity";
import type { z } from "zod/v4";
import {
  ChannelCompletenessManifestSchema,
  ChannelOverlapManifestSchema,
  GuildInventorySchema,
  PageManifestSchema,
  type CurrentMessage,
} from "#shared/glitter-corpus.ts";
import {
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
} from "#observability/metrics-glitter.ts";
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
import { readBaselineProjection } from "./glitter-corpus-baseline.ts";
import { discoverGuildInventory } from "./glitter-corpus-discord.ts";
import {
  DiscordRestClient,
  type DiscordRestClientHooks,
  type DiscordRestProgress,
} from "./glitter-corpus-discord-client.ts";
import { readOrCaptureDiscordPage } from "./glitter-corpus-capture-page.ts";
import {
  glitterCorpusRuntimeConfig,
  jsonBytes,
  readCorpusJson,
  readOverlapTraversal,
  readSeedChannelObservations,
  readTraversal,
  validateSeedForApprovedInventory,
  writeChannelProjection,
} from "./glitter-corpus-io.ts";
import { assertDiscordPageOrder } from "./glitter-corpus-page-order.ts";
import {
  finalizeGlitterCorpusSnapshot,
  loadGlitterCorpusDailyBaseline,
} from "./glitter-corpus-snapshot.ts";
import { createCorpusStoreFromEnv } from "./glitter-corpus-store.ts";
import {
  putImmutableObject,
  readRequiredObject,
} from "./glitter-corpus-storage.ts";
import {
  persistProjectionState,
  projectionStateFields,
} from "./glitter-corpus-state.ts";

const DISCORD_WAIT_HEARTBEAT_INTERVAL_MS = 15_000;

function temporalDiscordRestHooks(activity: string): DiscordRestClientHooks {
  const context = Context.current();
  const heartbeat = (progress: DiscordRestProgress): void => {
    context.heartbeat({ activity, ...progress });
  };
  return {
    cancellationSignal: context.cancellationSignal,
    onProgress: heartbeat,
    wait: async (delayMs, progress) => {
      let remainingMs = delayMs;
      while (remainingMs > 0) {
        heartbeat({ ...progress, delayMs: remainingMs });
        const chunkMs = Math.min(
          remainingMs,
          DISCORD_WAIT_HEARTBEAT_INTERVAL_MS,
        );
        await context.sleep(chunkMs);
        remainingMs -= chunkMs;
      }
    },
  };
}

async function inventoryGlitterGuild(input: {
  discoveredAt: string;
  baselineInventory?: z.input<typeof GuildInventorySchema>;
}): Promise<InventoryResult> {
  const config = glitterCorpusRuntimeConfig();
  const baselineInventory =
    input.baselineInventory === undefined
      ? undefined
      : GuildInventorySchema.parse(input.baselineInventory);
  const inventory = await discoverGuildInventory({
    token: config.token,
    guildId: config.guildId,
    guildSlug: config.guildSlug,
    denylistedChannelIds: config.denylistedChannelIds,
    discoveredAt: input.discoveredAt,
    ...(baselineInventory === undefined ? {} : { baselineInventory }),
    hooks: temporalDiscordRestHooks("inventory"),
  });
  glitterCorpusInventoryEntries.reset();
  for (const entry of inventory.entries) {
    glitterCorpusInventoryEntries.inc({
      decision: entry.scopeDecision,
    });
  }
  glitterCorpusInventoryScopeChanges.reset();
  if (baselineInventory !== undefined) {
    const baseline = baselineInventory;
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
  const inventoryObject = await putImmutableObject({
    store: createCorpusStoreFromEnv(),
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
  const bytes = await readRequiredObject({
    store: createCorpusStoreFromEnv(),
    key: input.inventoryKey,
  });
  const inventoryObject = await putImmutableObject({
    store: createCorpusStoreFromEnv(),
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

async function validateApprovedGlitterSeed(input: {
  seedPrefix: string;
  guildId: string;
  guildSlug: string;
  approvedChannelIds: string[];
}): Promise<void> {
  await validateSeedForApprovedInventory(input);
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
  const page = await readOrCaptureDiscordPage({
    request: input,
    client: new DiscordRestClient(
      config.token,
      temporalDiscordRestHooks("capture-page"),
    ),
  });
  const rawBody = new TextEncoder().encode(page.rawBody);
  const rawSha256 = sha256(rawBody);
  assertDiscordPageOrder({
    messageIds: page.data.map((message) => message.id),
    direction: input.direction,
    objectKey: `Discord response for ${input.requestId}`,
  });
  const rawObjectKey =
    `guilds/${input.guildId}/channels/${input.channelId}/raw/` +
    `${input.direction}/${input.requestId}/${rawSha256}.json`;
  const store = createCorpusStoreFromEnv();
  await putImmutableObject({
    store,
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
    rawSha256,
    retryCount: page.retryCount,
    rateLimit: page.rateLimit,
  });
  const manifestBody = jsonBytes(manifest);
  const manifestKey =
    `guilds/${input.guildId}/channels/${input.channelId}/pages/` +
    `${input.direction}/${input.requestId}/${sha256(manifestBody)}.json`;
  const manifestObject = await putImmutableObject({
    store,
    key: manifestKey,
    body: manifestBody,
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
  const backwardIds = backward.messageIds.toSorted(compareSnowflakes);
  const oldestBackwardMessageId = backwardIds[0];
  const newestBackwardMessageId = backwardIds.at(-1);
  if (newestBackwardMessageId !== input.forwardUpperBoundMessageId) {
    throw new Error(
      `frozen forward boundary for ${input.channelId} does not match the backward traversal`,
    );
  }
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
    ...(input.forwardUpperBoundMessageId === undefined
      ? {}
      : { upperBoundInclusive: input.forwardUpperBoundMessageId }),
    pageManifestKeys: input.forwardPageManifestKeys,
  });
  const forwardIds = forward.messageIds.toSorted(compareSnowflakes);
  if (JSON.stringify(backwardIds) !== JSON.stringify(forwardIds)) {
    throw new Error(
      `independent traversal mismatch for channel ${input.channelId}: backward=${String(backwardIds.length)} forward=${String(forwardIds.length)}`,
    );
  }

  // Include both traversals' observations: a message edited between the
  // backward and forward reads has a newer payload only on the forward pass,
  // and buildCurrentProjection dedups by message ID and keeps the latest
  // version, so carrying both is safe and avoids publishing a stale version.
  const observations = [
    ...backward.observations,
    ...forward.observations,
    ...(await readSeedChannelObservations({
      seedPrefix: input.seedPrefix,
      channelId: input.channelId,
    })),
  ];
  let retainedBaseline: CurrentMessage[] = [];
  if (input.retainedBaselineManifestKey !== undefined) {
    const retainedState = await readBaselineProjection({
      manifestKey: input.retainedBaselineManifestKey,
      guildId: input.guildId,
      channelId: input.channelId,
    });
    retainedBaseline = retainedState.messages;
  }
  const projection = mergeCurrentProjection(retainedBaseline, observations);
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
    lineageDepth: 0,
    seedPrefix: input.seedPrefix ?? null,
    retainedBaselineManifestKey: input.retainedBaselineManifestKey ?? null,
    retainedBaselineMessageCount: retainedBaseline.length,
    backwardProof: {
      direction: "backward",
      pageManifestKeys: input.backwardPageManifestKeys,
      terminalPageManifestKey: input.backwardPageManifestKeys.at(-1),
      terminalResponseCount: backward.terminal.responseCount,
      terminalReason: backward.terminalReason,
      upperBoundMessageId: null,
    },
    forwardProof: {
      direction: "forward",
      pageManifestKeys: input.forwardPageManifestKeys,
      terminalPageManifestKey: input.forwardPageManifestKeys.at(-1),
      terminalResponseCount: forward.terminal.responseCount,
      terminalReason: forward.terminalReason,
      upperBoundMessageId: input.forwardUpperBoundMessageId ?? null,
    },
    observationCount: observations.length,
    seedObservationCount:
      observations.length -
      backward.observations.length -
      forward.observations.length,
    duplicateObservationCount:
      retainedBaseline.length + observations.length - projection.length,
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
    lineageDepth: baseline.lineageDepth + 1,
    seedPrefix: baseline.seedPrefix,
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
  validateApprovedGlitterSeed,
  captureGlitterCorpusPage,
  verifyGlitterCorpusChannel,
  applyGlitterCorpusOverlap,
  finalizeGlitterCorpusSnapshot,
  loadGlitterCorpusDailyBaseline,
};
