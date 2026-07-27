import { executeChild, proxyActivities, uuid4 } from "@temporalio/workflow";
import type { glitterCorpusActivities } from "#activities/glitter-corpus.ts";
import type {
  CapturePageResult,
  ChannelStateResult,
  DailyBaseline,
  InventoryResult,
} from "#activities/glitter-corpus-activity-types.ts";

const PAGE_LIMIT_SAFETY_CEILING = 100_000;
const OVERLAP_DAYS = 7;
const MAX_OVERLAP_LINEAGE_DEPTH = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

const {
  inventoryGlitterGuild,
  loadApprovedGlitterInventory,
  validateApprovedGlitterSeed,
  captureGlitterCorpusPage,
  verifyGlitterCorpusChannel,
  applyGlitterCorpusOverlap,
  finalizeGlitterCorpusSnapshot,
  loadGlitterCorpusDailyBaseline,
} = proxyActivities<typeof glitterCorpusActivities>({
  startToCloseTimeout: "1 hour",
  retry: {
    maximumAttempts: 3,
    initialInterval: "10 seconds",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
  },
});

export type GlitterCorpusBackfillInput = {
  inventoryKey: string;
  inventorySha256: string;
  seedPrefix?: string;
  maxPagesPerChannel?: number;
};

export type GlitterCorpusSnapshotResult = Awaited<
  ReturnType<typeof finalizeGlitterCorpusSnapshot>
>;

type FullTraversalResult = {
  pageManifestKeys: string[];
  oldestMessageId: string | undefined;
  newestMessageId: string | undefined;
  terminalReason: "empty-channel" | "reached-upper-bound";
};

function nowIso(): string {
  return new Date().toISOString();
}

function smallestSnowflake(ids: readonly string[]): string | undefined {
  return ids.toSorted((left, right) => {
    if (left.length !== right.length) {
      return left.length - right.length;
    }
    return left.localeCompare(right);
  })[0];
}

function largestSnowflake(ids: readonly string[]): string | undefined {
  return ids.toSorted((left, right) => {
    if (left.length !== right.length) {
      return right.length - left.length;
    }
    return right.localeCompare(left);
  })[0];
}

function snowflakeImmediatelyBefore(id: string): string {
  const value = BigInt(id);
  if (value === 0n) {
    throw new Error("Discord snowflake cannot be zero");
  }
  return String(value - 1n);
}

async function capturePage(input: {
  guildId: string;
  guildSlug: string;
  channelId: string;
  direction: "backward" | "forward" | "daily-overlap";
  before?: string;
  after?: string;
}): Promise<CapturePageResult> {
  return await captureGlitterCorpusPage({
    requestId: uuid4(),
    guildId: input.guildId,
    guildSlug: input.guildSlug,
    channelId: input.channelId,
    direction: input.direction,
    ...(input.before === undefined ? {} : { before: input.before }),
    ...(input.after === undefined ? {} : { after: input.after }),
  });
}

async function captureFullTraversal(input: {
  guildId: string;
  guildSlug: string;
  channelId: string;
  direction: "backward" | "forward";
  initialAfter?: string;
  upperBoundInclusive?: string;
  maxPages: number;
}): Promise<FullTraversalResult> {
  const pageManifestKeys: string[] = [];
  let before: string | undefined;
  let after = input.initialAfter;
  let oldestMessageId: string | undefined;
  let newestMessageId: string | undefined;

  for (let pageIndex = 0; pageIndex < input.maxPages; pageIndex += 1) {
    const page = await capturePage({
      guildId: input.guildId,
      guildSlug: input.guildSlug,
      channelId: input.channelId,
      direction: input.direction,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    });
    pageManifestKeys.push(page.manifestKey);
    if (page.page.responseCount === 0) {
      return {
        pageManifestKeys,
        oldestMessageId,
        newestMessageId,
        terminalReason: "empty-channel",
      };
    }

    const pageSmallest = smallestSnowflake(page.messageIds);
    const pageLargest = largestSnowflake(page.messageIds);
    if (pageSmallest === undefined || pageLargest === undefined) {
      throw new Error(
        `non-empty ${input.direction} page had no message IDs for ${input.channelId}`,
      );
    }
    if (
      oldestMessageId === undefined ||
      BigInt(pageSmallest) < BigInt(oldestMessageId)
    ) {
      oldestMessageId = pageSmallest;
    }
    if (
      newestMessageId === undefined ||
      BigInt(pageLargest) > BigInt(newestMessageId)
    ) {
      newestMessageId = pageLargest;
    }
    if (input.direction === "backward") {
      before = pageSmallest;
    } else {
      if (
        input.upperBoundInclusive !== undefined &&
        BigInt(pageLargest) >= BigInt(input.upperBoundInclusive)
      ) {
        return {
          pageManifestKeys,
          oldestMessageId,
          newestMessageId,
          terminalReason: "reached-upper-bound",
        };
      }
      after = pageLargest;
    }
  }

  throw new Error(
    `${input.direction} traversal exceeded safety ceiling of ${String(input.maxPages)} pages for ${input.channelId}; refusing to mark it complete`,
  );
}

export type GlitterCorpusChannelBackfillInput = {
  snapshotId: string;
  guildId: string;
  guildSlug: string;
  channelId: string;
  verifiedAt: string;
  seedPrefix?: string;
  maxPages: number;
};

export async function runGlitterCorpusChannelBackfill(
  input: GlitterCorpusChannelBackfillInput,
): Promise<ChannelStateResult> {
  const backward = await captureFullTraversal({
    guildId: input.guildId,
    guildSlug: input.guildSlug,
    channelId: input.channelId,
    direction: "backward",
    maxPages: input.maxPages,
  });
  const forward = await captureFullTraversal({
    guildId: input.guildId,
    guildSlug: input.guildSlug,
    channelId: input.channelId,
    direction: "forward",
    ...(backward.oldestMessageId === undefined
      ? {}
      : {
          initialAfter: snowflakeImmediatelyBefore(backward.oldestMessageId),
        }),
    ...(backward.newestMessageId === undefined
      ? {}
      : { upperBoundInclusive: backward.newestMessageId }),
    maxPages: input.maxPages,
  });
  return await verifyGlitterCorpusChannel({
    snapshotId: input.snapshotId,
    guildId: input.guildId,
    guildSlug: input.guildSlug,
    channelId: input.channelId,
    verifiedAt: input.verifiedAt,
    backwardPageManifestKeys: backward.pageManifestKeys,
    forwardPageManifestKeys: forward.pageManifestKeys,
    ...(backward.newestMessageId === undefined
      ? {}
      : { forwardUpperBoundMessageId: backward.newestMessageId }),
    ...(input.seedPrefix === undefined ? {} : { seedPrefix: input.seedPrefix }),
  });
}

async function completeOverlap(
  input: {
    snapshotId: string;
    guildId: string;
    guildSlug: string;
    channelId: string;
    verifiedAt: string;
    baselineManifestKey: string;
    baselineNewestMessageId: string | null;
    overlapCutoff: string;
  },
  pageManifestKeys: string[],
  stoppedBecause: "cutoff-reached" | "empty-channel",
): Promise<ChannelStateResult> {
  return await applyGlitterCorpusOverlap({
    snapshotId: input.snapshotId,
    guildId: input.guildId,
    guildSlug: input.guildSlug,
    channelId: input.channelId,
    verifiedAt: input.verifiedAt,
    baselineManifestKey: input.baselineManifestKey,
    baselineNewestMessageId: input.baselineNewestMessageId,
    pageManifestKeys,
    overlapCutoff: input.overlapCutoff,
    stoppedBecause,
  });
}

async function captureOverlapPage(
  input: {
    guildId: string;
    guildSlug: string;
    channelId: string;
  },
  before: string | undefined,
): Promise<CapturePageResult> {
  return await capturePage({
    guildId: input.guildId,
    guildSlug: input.guildSlug,
    channelId: input.channelId,
    direction: "daily-overlap",
    ...(before === undefined ? {} : { before }),
  });
}

export type GlitterCorpusChannelOverlapInput = {
  snapshotId: string;
  guildId: string;
  guildSlug: string;
  channelId: string;
  verifiedAt: string;
  baselineManifestKey: string;
  baselineNewestMessageId: string | null;
  overlapCutoff: string;
  maxPages: number;
};

export async function runGlitterCorpusChannelOverlap(
  input: GlitterCorpusChannelOverlapInput,
): Promise<ChannelStateResult> {
  const pageManifestKeys: string[] = [];
  let before: string | undefined;
  for (let pageIndex = 0; pageIndex < input.maxPages; pageIndex += 1) {
    const page = await captureOverlapPage(input, before);
    pageManifestKeys.push(page.manifestKey);
    if (page.page.responseCount === 0) {
      return await completeOverlap(input, pageManifestKeys, "empty-channel");
    }
    const oldestTimestamp = page.messageTimestamps.toSorted()[0];
    const cursor = smallestSnowflake(page.messageIds);
    if (cursor === undefined) {
      throw new Error(
        `non-empty overlap page had no message IDs for ${input.channelId}`,
      );
    }
    const crossedBaselineBoundary =
      input.baselineNewestMessageId !== null &&
      BigInt(cursor) <= BigInt(input.baselineNewestMessageId);
    if (
      oldestTimestamp !== undefined &&
      oldestTimestamp <= input.overlapCutoff &&
      crossedBaselineBoundary
    ) {
      return await completeOverlap(input, pageManifestKeys, "cutoff-reached");
    }
    before = cursor;
  }
  throw new Error(
    `daily overlap exceeded safety ceiling of ${String(input.maxPages)} pages for ${input.channelId}`,
  );
}

function maxPages(input: number | undefined): number {
  const value = input ?? PAGE_LIMIT_SAFETY_CEILING;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("maxPagesPerChannel must be a positive integer");
  }
  return value;
}

export async function runGlitterCorpusInventory(): Promise<InventoryResult> {
  return await inventoryGlitterGuild({ discoveredAt: nowIso() });
}

export async function runGlitterCorpusBackfill(
  input: GlitterCorpusBackfillInput,
): Promise<GlitterCorpusSnapshotResult> {
  const approved = await loadApprovedGlitterInventory({
    inventoryKey: input.inventoryKey,
    expectedSha256: input.inventorySha256,
  });
  const snapshotId = uuid4();
  const createdAt = nowIso();
  const states: ChannelStateResult[] = [];
  const entries = approved.inventory.entries.filter(
    (entry) => entry.scopeDecision === "include",
  );
  if (input.seedPrefix !== undefined) {
    await validateApprovedGlitterSeed({
      seedPrefix: input.seedPrefix,
      approvedChannelIds: entries.map((entry) => entry.channelId),
    });
  }
  for (const entry of entries) {
    states.push(
      await executeChild(runGlitterCorpusChannelBackfill, {
        workflowId: `glitter-corpus-backfill-${snapshotId}-${entry.channelId}`,
        args: [
          {
            snapshotId,
            guildId: approved.inventory.guildId,
            guildSlug: approved.inventory.guildSlug,
            channelId: entry.channelId,
            verifiedAt: createdAt,
            ...(input.seedPrefix === undefined
              ? {}
              : { seedPrefix: input.seedPrefix }),
            maxPages: maxPages(input.maxPagesPerChannel),
          },
        ],
      }),
    );
  }
  return await finalizeGlitterCorpusSnapshot({
    snapshotId,
    guildId: approved.inventory.guildId,
    createdAt,
    inventoryObject: approved.inventoryObject,
    expectedChannelIds: entries.map((entry) => entry.channelId),
    channelStates: states,
  });
}

function findBaselineState(
  baseline: DailyBaseline,
  channelId: string,
): DailyBaseline["states"][string] | undefined {
  return baseline.states[channelId];
}

export async function runGlitterCorpusDaily(): Promise<GlitterCorpusSnapshotResult> {
  const baseline = await loadGlitterCorpusDailyBaseline();
  const currentInventory = await inventoryGlitterGuild({
    discoveredAt: nowIso(),
    baselineInventory: baseline.inventory,
  });
  if (currentInventory.inventory.guildId !== baseline.inventory.guildId) {
    throw new Error("daily inventory guild does not match baseline guild");
  }

  const snapshotId = uuid4();
  const createdAt = nowIso();
  const overlapCutoff = new Date(
    Date.now() - OVERLAP_DAYS * DAY_MS,
  ).toISOString();
  const states: ChannelStateResult[] = [];
  const currentIncluded = currentInventory.inventory.entries.filter(
    (entry) => entry.scopeDecision === "include",
  );

  for (const entry of currentInventory.inventory.entries) {
    const baselineState = findBaselineState(baseline, entry.channelId);
    if (
      baselineState !== undefined &&
      entry.scopeDecision === "exclude-no-history-permission"
    ) {
      throw new Error(
        `lost Discord history permission for previously captured channel ${entry.channelId}`,
      );
    }
  }

  for (const entry of currentIncluded) {
    const baselineState = findBaselineState(baseline, entry.channelId);
    if (
      baselineState === undefined ||
      baselineState.lineageDepth >= MAX_OVERLAP_LINEAGE_DEPTH
    ) {
      states.push(
        await executeChild(runGlitterCorpusChannelBackfill, {
          workflowId: `glitter-corpus-backfill-${snapshotId}-${entry.channelId}`,
          args: [
            {
              snapshotId,
              guildId: currentInventory.inventory.guildId,
              guildSlug: currentInventory.inventory.guildSlug,
              channelId: entry.channelId,
              verifiedAt: createdAt,
              ...(baselineState?.seedPrefix === undefined ||
              baselineState.seedPrefix === null
                ? {}
                : { seedPrefix: baselineState.seedPrefix }),
              maxPages: PAGE_LIMIT_SAFETY_CEILING,
            },
          ],
        }),
      );
    } else {
      states.push(
        await executeChild(runGlitterCorpusChannelOverlap, {
          workflowId: `glitter-corpus-overlap-${snapshotId}-${entry.channelId}`,
          args: [
            {
              snapshotId,
              guildId: currentInventory.inventory.guildId,
              guildSlug: currentInventory.inventory.guildSlug,
              channelId: entry.channelId,
              verifiedAt: createdAt,
              baselineManifestKey: baselineState.manifestKey,
              baselineNewestMessageId: baselineState.newestMessageId,
              overlapCutoff,
              maxPages: PAGE_LIMIT_SAFETY_CEILING,
            },
          ],
        }),
      );
    }
  }

  const currentIds = new Set(currentIncluded.map((entry) => entry.channelId));
  for (const [channelId, baselineState] of Object.entries(baseline.states)) {
    if (!currentIds.has(channelId)) {
      states.push({
        channelId,
        manifestKey: baselineState.manifestKey,
        manifestObject: baselineState.manifestObject,
        uniqueMessageCount: baselineState.uniqueMessageCount,
      });
    }
  }

  return await finalizeGlitterCorpusSnapshot({
    snapshotId,
    guildId: currentInventory.inventory.guildId,
    createdAt,
    inventoryObject: currentInventory.inventoryObject,
    expectedChannelIds: states.map((state) => state.channelId),
    channelStates: states,
  });
}
