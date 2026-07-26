import { describe, expect, test } from "bun:test";
import {
  ChannelOverlapManifestSchema,
  PageManifestSchema,
} from "./glitter-corpus.ts";

const UUID = "00000000-0000-4000-8000-000000000000";
const SHA256 = "0".repeat(64);
const TIMESTAMP = "2026-07-26T00:00:00.000Z";

function overlapManifest() {
  return {
    schemaVersion: 1,
    snapshotId: UUID,
    guildId: "1",
    channelId: "2",
    verifiedAt: TIMESTAMP,
    baselineManifestKey: "baseline.json",
    overlapPageManifestKeys: ["page.json"],
    overlapCutoff: TIMESTAMP,
    baselineNewestMessageId: "10",
    oldestObservedTimestamp: TIMESTAMP,
    oldestObservedMessageId: "10",
    stoppedBecause: "cutoff-reached",
    observationCount: 1,
    uniqueMessageCount: 1,
    oldestMessageId: "10",
    newestMessageId: "10",
    projectionObjectKey: "projection.ndjson",
    projectionSha256: SHA256,
    complete: true,
  } as const;
}

describe("Glitter corpus proof schemas", () => {
  test("a cutoff overlap must cross the previous newest-message boundary", () => {
    const result = ChannelOverlapManifestSchema.safeParse({
      ...overlapManifest(),
      oldestObservedMessageId: "11",
    });
    expect(result.success).toBe(false);
  });

  test("projection bounds cannot claim messages for an empty projection", () => {
    const result = ChannelOverlapManifestSchema.safeParse({
      ...overlapManifest(),
      observationCount: 0,
      uniqueMessageCount: 0,
    });
    expect(result.success).toBe(false);
  });

  test("an empty page cannot claim message boundaries", () => {
    const result = PageManifestSchema.safeParse({
      schemaVersion: 1,
      requestId: UUID,
      guildId: "1",
      channelId: "2",
      direction: "backward",
      before: null,
      after: null,
      requestedAt: TIMESTAMP,
      completedAt: TIMESTAMP,
      responseCount: 0,
      firstMessageId: "3",
      lastMessageId: "3",
      rawObjectKey: "raw.json",
      rawSha256: SHA256,
      retryCount: 0,
      rateLimit: {
        limit: 50,
        remaining: 49,
        resetAfterSeconds: 1,
        bucket: "bucket",
      },
    });
    expect(result.success).toBe(false);
  });
});
