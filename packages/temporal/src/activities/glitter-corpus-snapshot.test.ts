import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GuildInventorySchema,
  StoredObjectSchema,
} from "#shared/glitter-corpus.ts";
import { FinalizeSnapshotInputSchema } from "#shared/glitter-corpus-activity-types.ts";
import { createCorpusStoreFromEnv } from "./glitter-corpus-store.ts";
import {
  publishLatestSnapshotPointer,
  putImmutableObject,
  readVerifiedObject,
} from "./glitter-corpus-storage.ts";
import type * as GlitterCorpusStorage from "./glitter-corpus-storage.ts";
import { verifyGlitterCorpusSnapshotGraph } from "./glitter-corpus-recovery.ts";
import { finalizeGlitterCorpusSnapshot } from "./glitter-corpus-snapshot.ts";

const activityMocks = vi.hoisted(() => ({ heartbeat: vi.fn() }));

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({ heartbeat: activityMocks.heartbeat }),
  },
}));

vi.mock("./glitter-corpus-store.ts", () => ({
  createCorpusStoreFromEnv: vi.fn(),
}));

vi.mock("./glitter-corpus-storage.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof GlitterCorpusStorage>();
  return {
    ...actual,
    publishLatestSnapshotPointer: vi.fn(),
    putImmutableObject: vi.fn(),
    readVerifiedObject: vi.fn(),
  };
});

vi.mock("./glitter-corpus-recovery.ts", () => ({
  verifyGlitterCorpusSnapshotGraph: vi.fn(),
}));

const CREATED_AT = "2026-08-30T12:00:00.000Z";
const SHA256 = "a".repeat(64);

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

describe("Glitter corpus snapshot finalization", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("uses one store and clears periodic heartbeats after publication", async () => {
    vi.useFakeTimers();
    const store = {
      name: "seaweedfs",
      bucket: "corpus",
      client: new S3Client({
        region: "us-east-1",
        credentials: { accessKeyId: "test", secretAccessKey: "test" },
      }),
    } as const;
    const inventory = GuildInventorySchema.parse({
      schemaVersion: 1,
      guildId: "1000",
      guildSlug: "glitter-boys",
      guildName: "Glitter Boys",
      discoveredAt: CREATED_AT,
      denylistedChannelIds: [],
      entries: [],
      sha256: SHA256,
    });
    const inventoryObject = storedObject("inventory.json");
    const manifestObject = storedObject("states/10/top.json");
    const input = FinalizeSnapshotInputSchema.parse({
      snapshotId: "00000000-0000-4000-8000-000000000999",
      guildId: "1000",
      createdAt: CREATED_AT,
      inventoryObject,
      expectedChannelIds: ["10"],
      channelStates: [
        {
          channelId: "10",
          manifestKey: manifestObject.key,
          manifestObject,
          uniqueMessageCount: 1,
        },
      ],
    });

    vi.mocked(createCorpusStoreFromEnv).mockReturnValue(store);
    vi.mocked(readVerifiedObject).mockResolvedValue(
      new TextEncoder().encode(JSON.stringify(inventory)),
    );
    vi.mocked(verifyGlitterCorpusSnapshotGraph).mockImplementation(
      async (verificationInput) => {
        expect(verificationInput.store).toBe(store);
        verificationInput.onProgress?.({
          manifestKey: manifestObject.key,
          verifiedChannels: 1,
          totalChannels: 1,
          lineageStateCount: 2,
        });
        return 1;
      },
    );
    vi.mocked(putImmutableObject).mockImplementation(async (writeInput) => {
      expect(writeInput.store).toBe(store);
      return storedObject(writeInput.key);
    });
    vi.mocked(publishLatestSnapshotPointer).mockImplementation(
      async (publishInput) => {
        expect(publishInput.store).toBe(store);
      },
    );

    const result = await finalizeGlitterCorpusSnapshot(input);

    expect(result.snapshot.uniqueMessageCount).toBe(1);
    expect(createCorpusStoreFromEnv).toHaveBeenCalledTimes(1);
    expect(activityMocks.heartbeat).toHaveBeenCalledWith({
      phase: "verify-snapshot",
      manifestKey: manifestObject.key,
      verifiedChannels: 1,
      totalChannels: 1,
      lineageStateCount: 2,
    });
    const heartbeatCount = activityMocks.heartbeat.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(activityMocks.heartbeat).toHaveBeenCalledTimes(heartbeatCount);
    store.client.destroy();
  });
});
