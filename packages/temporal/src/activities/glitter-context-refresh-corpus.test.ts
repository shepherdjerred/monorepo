import { describe, expect, test } from "bun:test";
import { sha256 } from "#shared/glitter-corpus-projection.ts";
import {
  loadVerifiedGlitterCorpusWithReader,
  type GlitterCorpusObjectReader,
} from "./glitter-context-refresh-corpus.ts";

const GUILD_ID = "208425771172102144";
const PINNED_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000001";
const LATEST_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000002";
const CREATED_AT = "2026-07-30T00:00:00.000Z";

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function snapshotBytes(snapshotId: string): Uint8Array {
  const inventoryKey = `guilds/${GUILD_ID}/inventories/test.json`;
  const inventorySha256 = "a".repeat(64);
  return jsonBytes({
    schemaVersion: 1,
    snapshotId,
    guildId: GUILD_ID,
    createdAt: CREATED_AT,
    inventoryObject: {
      key: inventoryKey,
      sha256: inventorySha256,
      receipt: {
        store: "seaweedfs",
        bucket: "glitter-corpus",
        key: inventoryKey,
        sha256: inventorySha256,
        etag: '"inventory"',
        writtenAt: CREATED_AT,
      },
    },
    channelManifestObjects: [],
    expectedChannelIds: [],
    completeChannelIds: [],
    uniqueMessageCount: 0,
    complete: true,
  });
}

function latestPointerBytes(input: {
  snapshotKey: string;
  snapshotSha256: string;
}): Uint8Array {
  return jsonBytes({
    schemaVersion: 1,
    guildId: GUILD_ID,
    snapshotId: LATEST_SNAPSHOT_ID,
    snapshotKey: input.snapshotKey,
    snapshotSha256: input.snapshotSha256,
    publishedAt: "2026-07-30T01:00:00.000Z",
  });
}

function memoryReader(objects: ReadonlyMap<string, Uint8Array>): {
  reader: GlitterCorpusObjectReader;
  reads: string[];
} {
  const reads: string[] = [];
  return {
    reads,
    reader: {
      readRequired: async (key) => {
        reads.push(key);
        const bytes = objects.get(key);
        if (bytes === undefined) {
          throw new Error(`missing object ${key}`);
        }
        return bytes;
      },
      readVerified: async (key, expectedSha256) => {
        reads.push(key);
        const bytes = objects.get(key);
        if (bytes === undefined) {
          throw new Error(`missing object ${key}`);
        }
        const actualSha256 = sha256(bytes);
        if (actualSha256 !== expectedSha256) {
          throw new Error(
            `checksum mismatch for ${key}: expected ${expectedSha256}, got ${actualSha256}`,
          );
        }
        return bytes;
      },
    },
  };
}

describe("verified Glitter context corpus snapshot selection", () => {
  test("loads an exact immutable pin without consulting the latest pointer", async () => {
    const pinnedKey = `guilds/${GUILD_ID}/snapshots/${PINNED_SNAPSHOT_ID}.json`;
    const latestKey = `guilds/${GUILD_ID}/snapshots/${LATEST_SNAPSHOT_ID}.json`;
    const pointerKey = `guilds/${GUILD_ID}/snapshots/latest.json`;
    const pinnedBytes = snapshotBytes(PINNED_SNAPSHOT_ID);
    const latestBytes = snapshotBytes(LATEST_SNAPSHOT_ID);
    const { reader, reads } = memoryReader(
      new Map([
        [pinnedKey, pinnedBytes],
        [latestKey, latestBytes],
        [
          pointerKey,
          latestPointerBytes({
            snapshotKey: latestKey,
            snapshotSha256: sha256(latestBytes),
          }),
        ],
      ]),
    );

    const result = await loadVerifiedGlitterCorpusWithReader({
      guildId: GUILD_ID,
      snapshot: {
        snapshotId: PINNED_SNAPSHOT_ID,
        snapshotSha256: sha256(pinnedBytes),
      },
      reader,
    });

    expect(result.reference).toEqual({
      snapshotId: PINNED_SNAPSHOT_ID,
      snapshotKey: pinnedKey,
      snapshotSha256: sha256(pinnedBytes),
    });
    expect(result.snapshot.snapshotId).toBe(PINNED_SNAPSHOT_ID);
    expect(reads).toEqual([pinnedKey]);
  });

  test("uses and verifies the latest pointer when no pin is supplied", async () => {
    const latestKey = `guilds/${GUILD_ID}/snapshots/${LATEST_SNAPSHOT_ID}.json`;
    const pointerKey = `guilds/${GUILD_ID}/snapshots/latest.json`;
    const latestBytes = snapshotBytes(LATEST_SNAPSHOT_ID);
    const { reader, reads } = memoryReader(
      new Map([
        [latestKey, latestBytes],
        [
          pointerKey,
          latestPointerBytes({
            snapshotKey: latestKey,
            snapshotSha256: sha256(latestBytes),
          }),
        ],
      ]),
    );

    const result = await loadVerifiedGlitterCorpusWithReader({
      guildId: GUILD_ID,
      reader,
    });

    expect(result.snapshot.snapshotId).toBe(LATEST_SNAPSHOT_ID);
    expect(reads).toEqual([pointerKey, latestKey]);
  });

  test("fails closed when the pinned checksum does not match", async () => {
    const pinnedKey = `guilds/${GUILD_ID}/snapshots/${PINNED_SNAPSHOT_ID}.json`;
    const { reader } = memoryReader(
      new Map([[pinnedKey, snapshotBytes(PINNED_SNAPSHOT_ID)]]),
    );

    await expect(
      loadVerifiedGlitterCorpusWithReader({
        guildId: GUILD_ID,
        snapshot: {
          snapshotId: PINNED_SNAPSHOT_ID,
          snapshotSha256: "f".repeat(64),
        },
        reader,
      }),
    ).rejects.toThrow("checksum mismatch");
  });

  test("fails closed when the pinned object contains another snapshot", async () => {
    const pinnedKey = `guilds/${GUILD_ID}/snapshots/${PINNED_SNAPSHOT_ID}.json`;
    const bytes = snapshotBytes(LATEST_SNAPSHOT_ID);
    const { reader } = memoryReader(new Map([[pinnedKey, bytes]]));

    await expect(
      loadVerifiedGlitterCorpusWithReader({
        guildId: GUILD_ID,
        snapshot: {
          snapshotId: PINNED_SNAPSHOT_ID,
          snapshotSha256: sha256(bytes),
        },
        reader,
      }),
    ).rejects.toThrow(
      `snapshot object ${pinnedKey} contains snapshot ${LATEST_SNAPSHOT_ID}`,
    );
  });
});
