import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, type WorkerOptions } from "@temporalio/worker";
import type { z } from "zod/v4";
import {
  ApplyOverlapInputSchema,
  CapturePageInputSchema,
  CapturePageResultSchema,
  FinalizeSnapshotInputSchema,
  VerifyChannelInputSchema,
  type CapturePageInput,
} from "#shared/glitter-corpus-activity-types.ts";
import {
  GuildInventorySchema,
  GuildSnapshotSchema,
  StoredObjectSchema,
} from "#shared/glitter-corpus.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  glitterCorpusActivityRetry,
  glitterCorpusFinalizerActivityOptions,
} from "./glitter-corpus-activity-options.ts";
import {
  runGlitterCorpusBackfill,
  runGlitterCorpusChannelBackfill,
  runGlitterCorpusDaily,
} from "./glitter-corpus.ts";

const GUILD_ID = "1000";
const CREATED_AT = "2026-07-26T12:00:00.000Z";
const SHA256 = "a".repeat(64);
let testEnvironment: TestWorkflowEnvironment;

describe("Glitter corpus activity policy", () => {
  it("gives finalization a heartbeat timeout without changing retries", () => {
    expect(glitterCorpusFinalizerActivityOptions.heartbeatTimeout).toBe(
      "60 seconds",
    );
    expect(glitterCorpusFinalizerActivityOptions.retry).toEqual(
      glitterCorpusActivityRetry,
    );
    expect(glitterCorpusActivityRetry).toEqual({
      maximumAttempts: 3,
      initialInterval: "10 seconds",
      backoffCoefficient: 2,
      maximumInterval: "2 minutes",
    });
  });
});

beforeAll(async () => {
  testEnvironment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnvironment.teardown();
});

function storedObject(key: string) {
  return StoredObjectSchema.parse({
    key,
    sha256: SHA256,
    receipt: {
      store: "seaweedfs",
      bucket: "corpus",
      key,
      sha256: SHA256,
      etag: "seaweed-etag",
      writtenAt: CREATED_AT,
    },
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
    manifestObject: storedObject(manifestKey),
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
    snapshotObject: storedObject(snapshotKey),
  };
}

async function runGlitterWorkflow<T>(
  activities: NonNullable<WorkerOptions["activities"]>,
  execute: () => Promise<T>,
): Promise<T> {
  const workflowWorker = await Worker.create({
    connection: testEnvironment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath: new URL("index.ts", import.meta.url).pathname,
  });
  const activityWorker = await Worker.create({
    connection: testEnvironment.nativeConnection,
    taskQueue: TASK_QUEUES.GLITTER_CORPUS,
    activities,
  });
  const activityRun = activityWorker.run();
  try {
    return await workflowWorker.runUntil(execute());
  } finally {
    activityWorker.shutdown();
    await activityRun;
  }
}

describe("Glitter corpus workflows", () => {
  it("fails a traversal safety ceiling non-retryably", async () => {
    const activities = {
      captureGlitterCorpusPage: async (rawInput: CapturePageInput) => {
        const input = CapturePageInputSchema.parse(rawInput);
        return pageResult(input, ["2", "1"], [CREATED_AT, CREATED_AT]);
      },
    };

    let failure: unknown;
    try {
      await runGlitterWorkflow(activities, () =>
        testEnvironment.client.workflow.execute(
          runGlitterCorpusChannelBackfill,
          {
            args: [
              {
                snapshotId: "ceiling-test",
                guildId: GUILD_ID,
                guildSlug: "glitter-boys",
                channelId: "10",
                verifiedAt: CREATED_AT,
                maxPages: 1,
              },
            ],
            taskQueue: TASK_QUEUES.WORKFLOWS,
            workflowId: `glitter-corpus-ceiling-${crypto.randomUUID()}`,
          },
        ),
      );
    } catch (error) {
      failure = error;
    }

    if (!(failure instanceof Error)) {
      throw new Error("Expected workflow execution to fail");
    }
    const cause = failure.cause;
    if (!(cause instanceof ApplicationFailure)) {
      throw new TypeError(
        "Expected workflow failure to include an ApplicationFailure cause",
      );
    }
    expect(cause.type).toBe("GlitterCorpusTraversalSafetyCeilingExceeded");
    expect(cause.nonRetryable).toBe(true);
    expect(cause.message).toBe(
      "backward traversal exceeded safety ceiling of 1 pages for 10; refusing to mark it complete",
    );
  }, 30_000);

  it("freezes the forward traversal at the backward pass upper bound", async () => {
    const captured: CapturePageInput[] = [];
    const verified: z.input<typeof VerifyChannelInputSchema>[] = [];
    const approvedInventory = inventory(["10"]);
    const activities = {
      loadApprovedGlitterInventory: async () => ({
        inventory: approvedInventory,
        inventoryKey: "inventory.json",
        inventoryObject: storedObject("inventory.json"),
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
            ? pageResult(
                input,
                ["1", "2", "3"],
                [CREATED_AT, CREATED_AT, CREATED_AT],
              )
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
          manifestObject: storedObject(manifestKey),
          uniqueMessageCount: 2,
        };
      },
      finalizeGlitterCorpusSnapshot: finalSnapshot,
    };

    const result = await runGlitterWorkflow(activities, () =>
      testEnvironment.client.workflow.execute(runGlitterCorpusBackfill, {
        args: [
          {
            inventoryKey: "inventory.json",
            inventorySha256: SHA256,
            maxPagesPerChannel: 10,
          },
        ],
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowId: "glitter-corpus-backfill-test",
      }),
    );

    expect(result.snapshot.uniqueMessageCount).toBe(2);
    expect(captured.map((page) => page.direction)).toEqual([
      "backward",
      "backward",
      "forward",
    ]);
    expect(captured[1]?.before).toBe("1");
    expect(captured[2]?.after).toBe("0");
    expect(verified).toHaveLength(1);
    expect(verified[0]?.backwardPageManifestKeys).toHaveLength(2);
    expect(verified[0]?.forwardPageManifestKeys).toHaveLength(1);
    expect(verified[0]?.forwardUpperBoundMessageId).toBe("2");
  }, 30_000);
});

describe("Glitter corpus daily overlap workflows", () => {
  it("keeps paging after the time cutoff until it crosses the baseline ID", async () => {
    const overlapInputs: z.input<typeof ApplyOverlapInputSchema>[] = [];
    const captured: CapturePageInput[] = [];
    const baselineInventory = inventory(["10"]);
    const stateObject = storedObject("states/baseline.json");
    const activities = {
      loadGlitterCorpusDailyBaseline: async () => ({
        inventory: baselineInventory,
        inventoryObject: storedObject("inventory-baseline.json"),
        states: {
          "10": {
            manifestKey: stateObject.key,
            manifestObject: stateObject,
            uniqueMessageCount: 3,
            newestMessageId: "100",
            lineageDepth: 1,
            seedPrefix: null,
          },
        },
      }),
      inventoryGlitterGuild: async () => ({
        inventory: baselineInventory,
        inventoryKey: "inventory-current.json",
        inventoryObject: storedObject("inventory-current.json"),
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
          manifestObject: storedObject(manifestKey),
          uniqueMessageCount: 4,
        };
      },
      finalizeGlitterCorpusSnapshot: finalSnapshot,
    };

    const result = await runGlitterWorkflow(activities, () =>
      testEnvironment.client.workflow.execute(runGlitterCorpusDaily, {
        args: [],
        taskQueue: TASK_QUEUES.WORKFLOWS,
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
  }, 30_000);

  it("requires an empty page when the baseline has no newest message", async () => {
    const overlapInputs: z.input<typeof ApplyOverlapInputSchema>[] = [];
    const captured: CapturePageInput[] = [];
    const baselineInventory = inventory(["10"]);
    const stateObject = storedObject("states/empty-baseline.json");
    const activities = {
      loadGlitterCorpusDailyBaseline: async () => ({
        inventory: baselineInventory,
        inventoryObject: storedObject("inventory-empty-baseline.json"),
        states: {
          "10": {
            manifestKey: stateObject.key,
            manifestObject: stateObject,
            uniqueMessageCount: 0,
            newestMessageId: null,
            lineageDepth: 1,
            seedPrefix: null,
          },
        },
      }),
      inventoryGlitterGuild: async () => ({
        inventory: baselineInventory,
        inventoryKey: "inventory-current-empty-baseline.json",
        inventoryObject: storedObject("inventory-current-empty-baseline.json"),
      }),
      captureGlitterCorpusPage: async (rawInput: CapturePageInput) => {
        const input = CapturePageInputSchema.parse(rawInput);
        captured.push(input);
        if (input.direction !== "daily-overlap") {
          throw new Error(`unexpected direction ${input.direction}`);
        }
        return input.before === undefined
          ? pageResult(
              input,
              ["2", "1"],
              ["2010-01-02T00:00:00.000Z", "2010-01-01T00:00:00.000Z"],
            )
          : pageResult(input, [], []);
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
          manifestObject: storedObject(manifestKey),
          uniqueMessageCount: 2,
        };
      },
      finalizeGlitterCorpusSnapshot: finalSnapshot,
    };

    const result = await runGlitterWorkflow(activities, () =>
      testEnvironment.client.workflow.execute(runGlitterCorpusDaily, {
        args: [],
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowId: "glitter-corpus-daily-empty-baseline-test",
      }),
    );

    expect(result.snapshot.uniqueMessageCount).toBe(2);
    expect(captured).toHaveLength(2);
    expect(captured[1]?.before).toBe("1");
    expect(overlapInputs).toHaveLength(1);
    expect(overlapInputs[0]?.baselineNewestMessageId).toBeNull();
    expect(overlapInputs[0]?.stoppedBecause).toBe("empty-channel");
  }, 30_000);
});

describe("Glitter corpus periodic full refresh", () => {
  it("resets a six-overlap lineage with a complete traversal and retains its baseline", async () => {
    const captured: CapturePageInput[] = [];
    const verified: z.input<typeof VerifyChannelInputSchema>[] = [];
    const baselineInventory = inventory(["10"]);
    const stateObject = storedObject("states/deep-baseline.json");
    const activities = {
      loadGlitterCorpusDailyBaseline: async () => ({
        inventory: baselineInventory,
        inventoryObject: storedObject("inventory-deep-baseline.json"),
        states: {
          "10": {
            manifestKey: stateObject.key,
            manifestObject: stateObject,
            uniqueMessageCount: 2,
            newestMessageId: "2",
            lineageDepth: 6,
            seedPrefix: "seed/approved",
          },
        },
      }),
      inventoryGlitterGuild: async () => ({
        inventory: baselineInventory,
        inventoryKey: "inventory-current-deep-baseline.json",
        inventoryObject: storedObject("inventory-current-deep-baseline.json"),
      }),
      captureGlitterCorpusPage: async (rawInput: CapturePageInput) => {
        const input = CapturePageInputSchema.parse(rawInput);
        captured.push(input);
        return pageResult(input, [], []);
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
          manifestObject: storedObject(manifestKey),
          uniqueMessageCount: 2,
        };
      },
      finalizeGlitterCorpusSnapshot: finalSnapshot,
    };

    await runGlitterWorkflow(activities, () =>
      testEnvironment.client.workflow.execute(runGlitterCorpusDaily, {
        args: [],
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowId: "glitter-corpus-daily-full-refresh-test",
      }),
    );

    expect(captured.map((page) => page.direction)).toEqual([
      "backward",
      "forward",
    ]);
    expect(verified).toHaveLength(1);
    expect(verified[0]?.seedPrefix).toBe("seed/approved");
    expect(verified[0]?.retainedBaselineManifestKey).toBe(
      "states/deep-baseline.json",
    );
  }, 30_000);
});
