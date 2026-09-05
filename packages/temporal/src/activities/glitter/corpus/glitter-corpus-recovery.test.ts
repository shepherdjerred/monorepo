import { S3Client } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChannelCompletenessManifestSchema,
  ChannelOverlapManifestSchema,
  CorpusObservationSchema,
  GuildSnapshotSchema,
  PageManifestSchema,
  StoredObjectSchema,
  type ChannelStateManifest,
  type CorpusObservation,
  type CurrentMessage,
} from "#shared/glitter-corpus.ts";
import {
  mergeCurrentProjection,
  projectionChecksum,
  serializeProjection,
} from "#shared/glitter-corpus-projection.ts";
import {
  loadStateManifest,
  readOverlapTraversal,
  readSeedChannelObservations,
  readTraversal,
} from "./glitter-corpus-io.ts";
import { readVerifiedObject } from "./glitter-corpus-storage.ts";
import type * as GlitterCorpusStorage from "./glitter-corpus-storage.ts";
import type { CorpusStore } from "./glitter-corpus-store.ts";
import { verifyGlitterCorpusSnapshotGraph } from "./glitter-corpus-recovery.ts";

vi.mock("./glitter-corpus-io.ts", () => ({
  loadStateManifest: vi.fn(),
  readOverlapTraversal: vi.fn(),
  readSeedChannelObservations: vi.fn(),
  readTraversal: vi.fn(),
}));

vi.mock("./glitter-corpus-storage.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof GlitterCorpusStorage>();
  return { ...actual, readVerifiedObject: vi.fn() };
});

const CREATED_AT = "2026-08-30T12:00:00.000Z";
const GUILD_ID = "1000";
const SHA256 = "a".repeat(64);

function observation(channelId: string, messageId: string): CorpusObservation {
  return CorpusObservationSchema.parse({
    schemaVersion: 1,
    source: "discord-rest",
    sourceKey: `raw/${channelId}/${messageId}`,
    observedAt: CREATED_AT,
    guildId: GUILD_ID,
    guildSlug: "glitter-boys",
    channelId,
    messageId,
    author: {
      id: "2000",
      username: "tester",
      globalName: "Tester",
      discriminator: "0",
      bot: false,
      avatar: null,
    },
    content: `message-${messageId}`,
    timestamp: CREATED_AT,
    editedTimestamp: null,
    type: 0,
    flags: "0",
    pinned: false,
    tts: false,
    attachments: [],
    referencedMessageId: null,
    raw: { id: messageId },
  });
}

function storedObject(key: string) {
  return StoredObjectSchema.parse({
    key,
    sha256: SHA256,
    receipt: {
      store: "seaweedfs",
      bucket: "corpus",
      key,
      sha256: SHA256,
      etag: "etag",
      writtenAt: CREATED_AT,
    },
  });
}

function terminalPage(input: {
  channelId: string;
  direction: "backward" | "forward" | "daily-overlap";
  responseCount: 0 | 1;
  messageId: string;
}) {
  const hasMessage = input.responseCount === 1;
  return PageManifestSchema.parse({
    schemaVersion: 1,
    requestId: `00000000-0000-4000-8000-${input.channelId.padStart(12, "0")}`,
    guildId: GUILD_ID,
    channelId: input.channelId,
    direction: input.direction,
    before: null,
    after: input.direction === "forward" ? "0" : null,
    requestedAt: CREATED_AT,
    completedAt: CREATED_AT,
    responseCount: input.responseCount,
    firstMessageId: hasMessage ? input.messageId : null,
    lastMessageId: hasMessage ? input.messageId : null,
    rawObjectKey: `raw/${input.channelId}/${input.direction}`,
    rawSha256: SHA256,
    retryCount: 0,
    rateLimit: {
      limit: 100,
      remaining: 99,
      resetAfterSeconds: 0,
      bucket: "test",
    },
  });
}

function completeManifest(input: {
  channelId: string;
  messageId: string;
  projection: readonly CurrentMessage[];
  mismatch?: "count" | "checksum";
}): ChannelStateManifest {
  const backwardKey = `pages/${input.channelId}/backward`;
  const forwardKey = `pages/${input.channelId}/forward`;
  return ChannelCompletenessManifestSchema.parse({
    schemaVersion: 1,
    snapshotId: `00000000-0000-4000-8001-${input.channelId.padStart(12, "0")}`,
    guildId: GUILD_ID,
    channelId: input.channelId,
    verifiedAt: CREATED_AT,
    lineageDepth: 0,
    seedPrefix: null,
    retainedBaselineManifestKey: null,
    retainedBaselineMessageCount: 0,
    backwardProof: {
      direction: "backward",
      pageManifestKeys: [backwardKey],
      terminalPageManifestKey: backwardKey,
      terminalResponseCount: 0,
      terminalReason: "empty-channel",
      upperBoundMessageId: null,
    },
    forwardProof: {
      direction: "forward",
      pageManifestKeys: [forwardKey],
      terminalPageManifestKey: forwardKey,
      terminalResponseCount: 1,
      terminalReason: "reached-upper-bound",
      upperBoundMessageId: input.messageId,
    },
    observationCount: 2,
    seedObservationCount: 0,
    duplicateObservationCount: 1,
    uniqueMessageCount:
      input.mismatch === "count" ? 2 : input.projection.length,
    oldestMessageId: input.messageId,
    newestMessageId: input.messageId,
    projectionObjectKey: `projections/${input.channelId}/base.ndjson`,
    projectionSha256:
      input.mismatch === "checksum"
        ? "b".repeat(64)
        : projectionChecksum(input.projection),
    complete: true,
  });
}

function overlapManifest(input: {
  channelId: string;
  messageId: string;
  baselineKey: string;
  projection: readonly CurrentMessage[];
}): ChannelStateManifest {
  return ChannelOverlapManifestSchema.parse({
    schemaVersion: 1,
    snapshotId: `00000000-0000-4000-8002-${input.channelId.padStart(12, "0")}`,
    guildId: GUILD_ID,
    channelId: input.channelId,
    verifiedAt: CREATED_AT,
    lineageDepth: 1,
    seedPrefix: null,
    baselineManifestKey: input.baselineKey,
    overlapPageManifestKeys: [`pages/${input.channelId}/overlap`],
    overlapCutoff: CREATED_AT,
    baselineNewestMessageId: input.messageId,
    oldestObservedTimestamp: CREATED_AT,
    oldestObservedMessageId: input.messageId,
    stoppedBecause: "cutoff-reached",
    observationCount: 1,
    uniqueMessageCount: input.projection.length,
    oldestMessageId: input.messageId,
    newestMessageId: input.messageId,
    projectionObjectKey: `projections/${input.channelId}/overlap.ndjson`,
    projectionSha256: projectionChecksum(input.projection),
    complete: true,
  });
}

function snapshot(channelIds: readonly string[], uniqueMessageCount: number) {
  return GuildSnapshotSchema.parse({
    schemaVersion: 1,
    snapshotId: "00000000-0000-4000-8000-000000000999",
    guildId: GUILD_ID,
    createdAt: CREATED_AT,
    inventoryObject: storedObject("inventory.json"),
    channelManifestObjects: channelIds.map((channelId) =>
      storedObject(`states/${channelId}/top.json`),
    ),
    expectedChannelIds: channelIds,
    completeChannelIds: channelIds,
    uniqueMessageCount,
    complete: true,
  });
}

function testStore(): CorpusStore {
  return {
    name: "seaweedfs",
    bucket: "corpus",
    client: new S3Client({
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    }),
  };
}

function recoveryFixtures() {
  const observations = new Map([
    ["10", observation("10", "110")],
    ["20", observation("20", "220")],
  ]);
  const projections = new Map(
    [...observations].map(([channelId, value]) => [
      channelId,
      mergeCurrentProjection([], [value]),
    ]),
  );
  const manifests = new Map<string, ChannelStateManifest>();
  for (const channelId of observations.keys()) {
    const message = observations.get(channelId);
    const projection = projections.get(channelId);
    if (message === undefined || projection === undefined) {
      throw new Error(`missing fixture for ${channelId}`);
    }
    const baselineKey = `states/${channelId}/base.json`;
    manifests.set(
      baselineKey,
      completeManifest({
        channelId,
        messageId: message.messageId,
        projection,
      }),
    );
    manifests.set(
      `states/${channelId}/top.json`,
      overlapManifest({
        channelId,
        messageId: message.messageId,
        baselineKey,
        projection,
      }),
    );
  }
  return { observations, projections, manifests };
}

function installRecoveryReaderMocks(input: {
  store: CorpusStore;
  observations: ReadonlyMap<string, CorpusObservation>;
  projections: ReadonlyMap<string, readonly CurrentMessage[]>;
  manifests: ReadonlyMap<string, ChannelStateManifest>;
}): void {
  vi.mocked(loadStateManifest).mockImplementation(async (store, key) => {
    expect(store).toBe(input.store);
    const manifest = input.manifests.get(key);
    if (manifest === undefined) {
      throw new Error(`unexpected manifest ${key}`);
    }
    return manifest;
  });
  vi.mocked(readTraversal).mockImplementation(async (traversalInput) => {
    expect(traversalInput.store).toBe(input.store);
    const message = input.observations.get(traversalInput.channelId);
    if (message === undefined) {
      throw new Error(`unexpected channel ${traversalInput.channelId}`);
    }
    return traversalInput.direction === "backward"
      ? {
          observations: [message],
          messageIds: [message.messageId],
          terminal: terminalPage({
            channelId: traversalInput.channelId,
            direction: "backward",
            responseCount: 0,
            messageId: message.messageId,
          }),
          terminalReason: "empty-channel" as const,
        }
      : {
          observations: [message],
          messageIds: [message.messageId],
          terminal: terminalPage({
            channelId: traversalInput.channelId,
            direction: "forward",
            responseCount: 1,
            messageId: message.messageId,
          }),
          terminalReason: "reached-upper-bound" as const,
        };
  });
  vi.mocked(readOverlapTraversal).mockImplementation(async (overlapInput) => {
    expect(overlapInput.store).toBe(input.store);
    const message = input.observations.get(overlapInput.channelId);
    if (message === undefined) {
      throw new Error(`unexpected channel ${overlapInput.channelId}`);
    }
    return {
      observations: [message],
      messageIds: [message.messageId],
      timestamps: [message.timestamp],
      terminal: terminalPage({
        channelId: overlapInput.channelId,
        direction: "daily-overlap",
        responseCount: 1,
        messageId: message.messageId,
      }),
    };
  });
  vi.mocked(readSeedChannelObservations).mockImplementation(
    async (seedInput) => {
      expect(seedInput.store).toBe(input.store);
      return [];
    },
  );
  vi.mocked(readVerifiedObject).mockImplementation(async (objectInput) => {
    expect(objectInput.store).toBe(input.store);
    const channelId = objectInput.key.split("/")[1];
    const projection =
      channelId === undefined ? undefined : input.projections.get(channelId);
    return new TextEncoder().encode(
      projection === undefined ? "" : serializeProjection(projection),
    );
  });
}

describe("Glitter corpus snapshot recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isolates each channel lineage while reusing one store and reporting progress", async () => {
    const store = testStore();
    const fixtures = recoveryFixtures();
    installRecoveryReaderMocks({ store, ...fixtures });

    const progress: unknown[] = [];
    await expect(
      verifyGlitterCorpusSnapshotGraph({
        snapshot: snapshot(["10", "20"], 2),
        guildSlug: "glitter-boys",
        store,
        onProgress: (value) => progress.push(value),
      }),
    ).resolves.toBe(2);

    expect(progress).toEqual([
      {
        manifestKey: "states/10/top.json",
        verifiedChannels: 1,
        totalChannels: 2,
        lineageStateCount: 2,
      },
      {
        manifestKey: "states/20/top.json",
        verifiedChannels: 2,
        totalChannels: 2,
        lineageStateCount: 2,
      },
    ]);
    expect(
      new Set(
        vi.mocked(readVerifiedObject).mock.calls.map(([input]) => input.store),
      ),
    ).toEqual(new Set([store]));
    store.client.destroy();
  });

  it.each(["count", "checksum"] as const)(
    "rejects a projection %s mismatch",
    async (mismatch) => {
      const store = {
        name: "seaweedfs",
        bucket: "corpus",
        client: new S3Client({
          region: "us-east-1",
          credentials: { accessKeyId: "test", secretAccessKey: "test" },
        }),
      } as const;
      const message = observation("10", "110");
      const projection = mergeCurrentProjection([], [message]);
      const manifest = completeManifest({
        channelId: "10",
        messageId: message.messageId,
        projection,
        mismatch,
      });
      vi.mocked(loadStateManifest).mockResolvedValue(manifest);
      vi.mocked(readTraversal).mockImplementation(async (input) =>
        input.direction === "backward"
          ? {
              observations: [message],
              messageIds: [message.messageId],
              terminal: terminalPage({
                channelId: "10",
                direction: "backward",
                responseCount: 0,
                messageId: message.messageId,
              }),
              terminalReason: "empty-channel" as const,
            }
          : {
              observations: [message],
              messageIds: [message.messageId],
              terminal: terminalPage({
                channelId: "10",
                direction: "forward",
                responseCount: 1,
                messageId: message.messageId,
              }),
              terminalReason: "reached-upper-bound" as const,
            },
      );
      vi.mocked(readSeedChannelObservations).mockResolvedValue([]);
      vi.mocked(readVerifiedObject).mockResolvedValue(
        new TextEncoder().encode(serializeProjection(projection)),
      );

      await expect(
        verifyGlitterCorpusSnapshotGraph({
          snapshot: snapshot(["10"], mismatch === "count" ? 2 : 1),
          guildSlug: "glitter-boys",
          store,
        }),
      ).rejects.toThrow("rebuilt projection does not match state");
      store.client.destroy();
    },
  );
});
