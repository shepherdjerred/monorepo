import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { z } from "zod/v4";
import {
  ApplyOverlapInputSchema,
  CapturePageInputSchema,
  CapturePageResultSchema,
  FinalizeSnapshotInputSchema,
  VerifyChannelInputSchema,
  type CapturePageInput,
} from "#activities/glitter-corpus-activity-types.ts";
import {
  GuildInventorySchema,
  GuildSnapshotSchema,
  MirroredObjectSchema,
} from "#shared/glitter-corpus.ts";
import {
  runGlitterCorpusBackfill,
  runGlitterCorpusDaily,
} from "./glitter-corpus.ts";

const TASK_QUEUE = "glitter-corpus-test";
const GUILD_ID = "1000";
const CREATED_AT = "2026-07-26T12:00:00.000Z";
const SHA256 = "a".repeat(64);
let testEnvironment: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnvironment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnvironment.teardown();
});

function mirroredObject(key: string) {
  return MirroredObjectSchema.parse({
    key,
    sha256: SHA256,
    receipts: [
      {
        store: "seaweedfs",
        bucket: "corpus",
        key,
        sha256: SHA256,
        etag: "seaweed-etag",
        writtenAt: CREATED_AT,
      },
      {
        store: "r2",
        bucket: "corpus",
        key,
        sha256: SHA256,
        etag: "r2-etag",
        writtenAt: CREATED_AT,
      },
    ],
  });
}

function inventory(channelIds: readonly string[]) {
  return GuildInventorySchema.parse({
    schemaVersion: 1,
    guildId: GUILD_ID,
    guildSlug: "glitter-boys",
    guildName: "Glitter Boys",
    discoveredAt: CREATED_AT,
    denylistedChannelIds: [],
    entries: channelIds.map((channelId) => ({
      guildId: GUILD_ID,
      channelId,
      parentId: null,
      name: `channel-${channelId}`,
      type: 0,
      archived: false,
      locked: false,
      scopeDecision: "include",
      discoveredAt: CREATED_AT,
    })),
    sha256: SHA256,
  });
}

function pageResult(
  rawInput: CapturePageInput,
  messageIds: readonly string[],
  timestamps: readonly string[],
) {
  const input = CapturePageInputSchema.parse(rawInput);
  const manifestKey =
    `guilds/${input.guildId}/channels/${input.channelId}/pages/` +
    `${input.direction}/${input.requestId}.json`;
  return CapturePageResultSchema.parse({
    manifestKey,
    manifestObject: mirroredObject(manifestKey),
    page: {
      schemaVersion: 1,
      requestId: input.requestId,
      guildId: input.guildId,
      channelId: input.channelId,
      direction: input.direction,
      before: input.before ?? null,
      after: input.after ?? null,
      requestedAt: CREATED_AT,
      completedAt: CREATED_AT,
      responseCount: messageIds.length,
      firstMessageId: messageIds[0] ?? null,
      lastMessageId: messageIds.at(-1) ?? null,
      rawObjectKey: `${manifestKey}.raw`,
      rawSha256: SHA256,
      retryCount: 0,
      rateLimit: {
        limit: 100,
        remaining: 99,
        resetAfterSeconds: 1,
        bucket: "test",
      },
    },
    messageIds,
    messageTimestamps: timestamps,
  });
}

function finalSnapshot(rawInput: z.input<typeof FinalizeSnapshotInputSchema>) {
  const input = FinalizeSnapshotInputSchema.parse(rawInput);
  const snapshotKey = `guilds/${input.guildId}/snapshots/${input.snapshotId}.json`;
  const channelManifestObjects = input.channelStates.map(
    (state) => state.manifestObject,
  );
  const completeChannelIds = input.channelStates.map(
    (state) => state.channelId,
  );
  const uniqueMessageCount = input.channelStates.reduce(
    (total, state) => total + state.uniqueMessageCount,
    0,
  );
  return {
    snapshot: GuildSnapshotSchema.parse({
      schemaVersion: 1,
      snapshotId: input.snapshotId,
      guildId: input.guildId,
      createdAt: input.createdAt,
      inventoryObject: input.inventoryObject,
      channelManifestObjects,
      expectedChannelIds: input.expectedChannelIds,
      completeChannelIds,
      uniqueMessageCount,
      complete: true,
    }),
    snapshotKey,
    snapshotObject: mirroredObject(snapshotKey),
  };
}

describe("Glitter corpus workflows", () => {
  it("requires independent terminal backward and forward traversals", async () => {
    const captured: CapturePageInput[] = [];
    const verified: z.input<typeof VerifyChannelInputSchema>[] = [];
    const approvedInventory = inventory(["10"]);
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        loadApprovedGlitterInventory: async () => ({
          inventory: approvedInventory,
          inventoryKey: "inventory.json",
          inventoryObject: mirroredObject("inventory.json"),
        }),
        captureGlitterCorpusPage: async (rawInput: CapturePageInput) => {
          const input = CapturePageInputSchema.parse(rawInput);
          captured.push(input);
          if (input.direction === "backward") {
            return input.before === undefined
              ? pageResult(input, ["2", "1"], [CREATED_AT, CREATED_AT])
              : pageResult(input, [], []);
          }
          if (input.direction === "forward") {
            return input.after === "0"
              ? pageResult(input, ["2", "1"], [CREATED_AT, CREATED_AT])
              : pageResult(input, [], []);
          }
          throw new Error(`unexpected direction ${input.direction}`);
        },
        verifyGlitterCorpusChannel: async (
          rawInput: z.input<typeof VerifyChannelInputSchema>,
        ) => {
          const input = VerifyChannelInputSchema.parse(rawInput);
          verified.push(input);
          const manifestKey = `states/${input.snapshotId}.json`;
          return {
            channelId: input.channelId,
            manifestKey,
            manifestObject: mirroredObject(manifestKey),
            uniqueMessageCount: 2,
          };
        },
        finalizeGlitterCorpusSnapshot: finalSnapshot,
      },
    });

    const result = await worker.runUntil(
      testEnvironment.client.workflow.execute(runGlitterCorpusBackfill, {
        args: [
          {
            inventoryKey: "inventory.json",
            inventorySha256: SHA256,
            maxPagesPerChannel: 10,
          },
        ],
        taskQueue: TASK_QUEUE,
        workflowId: "glitter-corpus-backfill-test",
      }),
    );

    expect(result.snapshot.uniqueMessageCount).toBe(2);
    expect(captured.map((page) => page.direction)).toEqual([
      "backward",
      "backward",
      "forward",
      "forward",
    ]);
    expect(captured[1]?.before).toBe("1");
    expect(captured[2]?.after).toBe("0");
    expect(captured[3]?.after).toBe("2");
    expect(verified).toHaveLength(1);
    expect(verified[0]?.backwardPageManifestKeys).toHaveLength(2);
    expect(verified[0]?.forwardPageManifestKeys).toHaveLength(2);
  });

  it("keeps paging after the time cutoff until it crosses the baseline ID", async () => {
    const overlapInputs: z.input<typeof ApplyOverlapInputSchema>[] = [];
    const captured: CapturePageInput[] = [];
    const baselineInventory = inventory(["10"]);
    const stateObject = mirroredObject("states/baseline.json");
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        loadGlitterCorpusDailyBaseline: async () => ({
          inventory: baselineInventory,
          inventoryObject: mirroredObject("inventory-baseline.json"),
          states: {
            "10": {
              manifestKey: stateObject.key,
              manifestObject: stateObject,
              uniqueMessageCount: 3,
              newestMessageId: "100",
            },
          },
        }),
        inventoryGlitterGuild: async () => ({
          inventory: baselineInventory,
          inventoryKey: "inventory-current.json",
          inventoryObject: mirroredObject("inventory-current.json"),
        }),
        captureGlitterCorpusPage: async (rawInput: CapturePageInput) => {
          const input = CapturePageInputSchema.parse(rawInput);
          captured.push(input);
          if (input.direction !== "daily-overlap") {
            throw new Error(`unexpected direction ${input.direction}`);
          }
          if (input.before === undefined) {
            return pageResult(
              input,
              ["300", "200"],
              ["2010-01-02T00:00:00.000Z", "2010-01-01T00:00:00.000Z"],
            );
          }
          return pageResult(
            input,
            ["100", "99"],
            ["2009-12-31T00:00:00.000Z", "2009-12-30T00:00:00.000Z"],
          );
        },
        applyGlitterCorpusOverlap: async (
          rawInput: z.input<typeof ApplyOverlapInputSchema>,
        ) => {
          const input = ApplyOverlapInputSchema.parse(rawInput);
          overlapInputs.push(input);
          const manifestKey = `states/${input.snapshotId}.json`;
          return {
            channelId: input.channelId,
            manifestKey,
            manifestObject: mirroredObject(manifestKey),
            uniqueMessageCount: 4,
          };
        },
        finalizeGlitterCorpusSnapshot: finalSnapshot,
      },
    });

    const result = await worker.runUntil(
      testEnvironment.client.workflow.execute(runGlitterCorpusDaily, {
        args: [],
        taskQueue: TASK_QUEUE,
        workflowId: "glitter-corpus-daily-overlap-test",
      }),
    );

    expect(result.snapshot.uniqueMessageCount).toBe(4);
    expect(captured).toHaveLength(2);
    expect(captured[1]?.before).toBe("200");
    expect(overlapInputs).toHaveLength(1);
    expect(overlapInputs[0]?.baselineNewestMessageId).toBe("100");
    expect(overlapInputs[0]?.pageManifestKeys).toHaveLength(2);
    expect(overlapInputs[0]?.stoppedBecause).toBe("cutoff-reached");
  });
});
