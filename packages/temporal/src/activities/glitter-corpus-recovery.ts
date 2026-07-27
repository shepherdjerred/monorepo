import {
  GuildInventorySchema,
  GuildSnapshotSchema,
  type ChannelStateManifest,
  type CurrentMessage,
  type GuildSnapshot,
} from "#shared/glitter-corpus.ts";
import {
  buildCurrentProjection,
  compareSnowflakes,
  mergeCurrentProjection,
  projectionChecksum,
  sha256,
} from "#shared/glitter-corpus-projection.ts";
import {
  loadStateManifest,
  readOverlapTraversal,
  readSeedChannelObservations,
  readTraversal,
} from "./glitter-corpus-io.ts";
import { createCorpusStoresFromEnv } from "./glitter-corpus-store.ts";
import {
  LatestSnapshotPointerSchema,
  readMirroredObject,
} from "./glitter-corpus-storage.ts";

type RebuildContext = {
  guildSlug: string;
  cache: Map<string, CurrentMessage[]>;
  active: Set<string>;
};

function immediatelyBefore(messageId: string): string {
  const value = BigInt(messageId);
  if (value === 0n) {
    throw new Error("Discord snowflake cannot be zero");
  }
  return String(value - 1n);
}

function assertProjectionMatchesManifest(
  manifest: ChannelStateManifest,
  projection: readonly CurrentMessage[],
): void {
  const oldestMessageId = projection[0]?.messageId ?? null;
  const newestMessageId = projection.at(-1)?.messageId ?? null;
  if (
    projection.length !== manifest.uniqueMessageCount ||
    oldestMessageId !== manifest.oldestMessageId ||
    newestMessageId !== manifest.newestMessageId ||
    projectionChecksum(projection) !== manifest.projectionSha256
  ) {
    throw new Error(
      `rebuilt projection does not match state ${manifest.snapshotId}:${manifest.channelId}`,
    );
  }
}

async function rebuildCompleteState(
  manifest: Extract<ChannelStateManifest, { backwardProof: unknown }>,
  context: RebuildContext,
): Promise<CurrentMessage[]> {
  const backward = await readTraversal({
    guildId: manifest.guildId,
    guildSlug: context.guildSlug,
    channelId: manifest.channelId,
    direction: "backward",
    pageManifestKeys: manifest.backwardProof.pageManifestKeys,
  });
  const oldestMessageId = backward.messageIds.toSorted(compareSnowflakes)[0];
  const forward = await readTraversal({
    guildId: manifest.guildId,
    guildSlug: context.guildSlug,
    channelId: manifest.channelId,
    direction: "forward",
    ...(oldestMessageId === undefined
      ? {}
      : { initialAfter: immediatelyBefore(oldestMessageId) }),
    ...(manifest.forwardProof.upperBoundMessageId === null
      ? {}
      : {
          upperBoundInclusive: manifest.forwardProof.upperBoundMessageId,
        }),
    pageManifestKeys: manifest.forwardProof.pageManifestKeys,
  });
  const backwardIds = backward.messageIds.toSorted(compareSnowflakes);
  const forwardIds = forward.messageIds.toSorted(compareSnowflakes);
  const newestBackwardId = backwardIds.at(-1) ?? null;
  if (newestBackwardId !== manifest.forwardProof.upperBoundMessageId) {
    throw new Error(
      `recovery frozen forward boundary differs for ${manifest.channelId}`,
    );
  }
  if (
    backward.terminalReason !== manifest.backwardProof.terminalReason ||
    backward.terminal.responseCount !==
      manifest.backwardProof.terminalResponseCount ||
    forward.terminalReason !== manifest.forwardProof.terminalReason ||
    forward.terminal.responseCount !==
      manifest.forwardProof.terminalResponseCount
  ) {
    throw new Error(
      `recovery traversal terminal proof differs for ${manifest.channelId}`,
    );
  }
  if (JSON.stringify(backwardIds) !== JSON.stringify(forwardIds)) {
    throw new Error(
      `recovery traversal mismatch for channel ${manifest.channelId}`,
    );
  }
  const seed = await readSeedChannelObservations({
    seedPrefix: manifest.seedPrefix ?? undefined,
    channelId: manifest.channelId,
  });
  if (seed.length !== manifest.seedObservationCount) {
    throw new Error(
      `recovery seed count mismatch for channel ${manifest.channelId}`,
    );
  }
  const observations = [...backward.observations, ...seed];
  const projection = buildCurrentProjection(observations);
  if (
    observations.length !== manifest.observationCount ||
    observations.length - projection.length !==
      manifest.duplicateObservationCount
  ) {
    throw new Error(
      `recovery observation reconciliation failed for ${manifest.channelId}`,
    );
  }
  return projection;
}

export async function verifyGlitterCorpusSnapshotGraph(input: {
  snapshot: GuildSnapshot;
  guildSlug: string;
}): Promise<number> {
  const stores = createCorpusStoresFromEnv();
  const context: RebuildContext = {
    guildSlug: input.guildSlug,
    cache: new Map(),
    active: new Set(),
  };
  let uniqueMessageCount = 0;
  for (const manifestObject of input.snapshot.channelManifestObjects) {
    const manifestBytes = await readMirroredObject({
      stores,
      key: manifestObject.key,
    });
    if (
      manifestBytes === undefined ||
      sha256(manifestBytes) !== manifestObject.sha256
    ) {
      throw new Error(
        `snapshot state checksum mismatch: ${manifestObject.key}`,
      );
    }
    const projection = await rebuildState(manifestObject.key, context);
    uniqueMessageCount += projection.length;
  }
  if (uniqueMessageCount !== input.snapshot.uniqueMessageCount) {
    throw new Error(
      `rebuilt snapshot count ${String(uniqueMessageCount)} does not match ${String(input.snapshot.uniqueMessageCount)}`,
    );
  }
  return uniqueMessageCount;
}

async function rebuildOverlapState(
  manifest: Extract<ChannelStateManifest, { baselineManifestKey: unknown }>,
  context: RebuildContext,
): Promise<CurrentMessage[]> {
  const baseline = await rebuildState(manifest.baselineManifestKey, context);
  const { observations, messageIds, timestamps, terminal } =
    await readOverlapTraversal({
      guildId: manifest.guildId,
      guildSlug: context.guildSlug,
      channelId: manifest.channelId,
      pageManifestKeys: manifest.overlapPageManifestKeys,
    });
  if (
    manifest.stoppedBecause === "empty-channel" &&
    terminal.responseCount !== 0
  ) {
    throw new Error(
      `recovery overlap lacks an empty terminal page for ${manifest.channelId}`,
    );
  }
  const oldestObservedMessageId =
    messageIds.toSorted(compareSnowflakes)[0] ?? null;
  const oldestObservedTimestamp = timestamps.toSorted()[0] ?? null;
  if (
    oldestObservedMessageId !== manifest.oldestObservedMessageId ||
    oldestObservedTimestamp !== manifest.oldestObservedTimestamp
  ) {
    throw new Error(
      `recovery overlap boundaries differ for ${manifest.channelId}`,
    );
  }
  if (observations.length !== manifest.observationCount) {
    throw new Error(
      `recovery overlap observation count differs for ${manifest.channelId}`,
    );
  }
  return mergeCurrentProjection(baseline, observations);
}

async function rebuildState(
  manifestKey: string,
  context: RebuildContext,
): Promise<CurrentMessage[]> {
  const cached = context.cache.get(manifestKey);
  if (cached !== undefined) {
    return cached;
  }
  if (context.active.has(manifestKey)) {
    throw new Error(`cycle in corpus state chain at ${manifestKey}`);
  }
  context.active.add(manifestKey);
  const manifest = await loadStateManifest(manifestKey);
  const projection =
    "backwardProof" in manifest
      ? await rebuildCompleteState(manifest, context)
      : await rebuildOverlapState(manifest, context);
  assertProjectionMatchesManifest(manifest, projection);
  const stored = await readMirroredObject({
    stores: createCorpusStoresFromEnv(),
    key: manifest.projectionObjectKey,
  });
  if (stored === undefined || sha256(stored) !== manifest.projectionSha256) {
    throw new Error(
      `stored projection does not match recovery state ${manifestKey}`,
    );
  }
  context.active.delete(manifestKey);
  context.cache.set(manifestKey, projection);
  return projection;
}

export async function verifyLatestGlitterCorpusSnapshot(): Promise<{
  guildId: string;
  snapshotId: string;
  channelCount: number;
  uniqueMessageCount: number;
  snapshotSha256: string;
}> {
  const guildId = Bun.env["GLITTER_DISCORD_GUILD_ID"];
  if (guildId === undefined || guildId === "") {
    throw new Error("GLITTER_DISCORD_GUILD_ID is required");
  }
  const stores = createCorpusStoresFromEnv();
  const pointerKey = `guilds/${guildId}/snapshots/latest.json`;
  const pointerBytes = await readMirroredObject({ stores, key: pointerKey });
  if (pointerBytes === undefined) {
    throw new Error(`latest corpus pointer is missing: ${pointerKey}`);
  }
  const pointer = LatestSnapshotPointerSchema.parse(
    JSON.parse(new TextDecoder().decode(pointerBytes)),
  );
  if (pointer.guildId !== guildId) {
    throw new Error(`latest corpus pointer belongs to ${pointer.guildId}`);
  }
  const snapshotBytes = await readMirroredObject({
    stores,
    key: pointer.snapshotKey,
  });
  if (
    snapshotBytes === undefined ||
    sha256(snapshotBytes) !== pointer.snapshotSha256
  ) {
    throw new Error(
      `latest snapshot checksum mismatch: ${pointer.snapshotKey}`,
    );
  }
  const snapshot = GuildSnapshotSchema.parse(
    JSON.parse(new TextDecoder().decode(snapshotBytes)),
  );
  const inventoryBytes = await readMirroredObject({
    stores,
    key: snapshot.inventoryObject.key,
  });
  if (
    inventoryBytes === undefined ||
    sha256(inventoryBytes) !== snapshot.inventoryObject.sha256
  ) {
    throw new Error(
      `snapshot inventory checksum mismatch: ${snapshot.inventoryObject.key}`,
    );
  }
  const inventory = GuildInventorySchema.parse(
    JSON.parse(new TextDecoder().decode(inventoryBytes)),
  );
  const uniqueMessageCount = await verifyGlitterCorpusSnapshotGraph({
    snapshot,
    guildSlug: inventory.guildSlug,
  });
  return {
    guildId,
    snapshotId: snapshot.snapshotId,
    channelCount: snapshot.completeChannelIds.length,
    uniqueMessageCount,
    snapshotSha256: pointer.snapshotSha256,
  };
}
