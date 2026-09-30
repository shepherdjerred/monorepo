import { tool } from "ai";
import { z } from "zod";
import {
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  BucksAccountQueryResultSchema,
  BucksAccountQuerySchema,
  BucksAskDatasetOverviewSchema,
  BucksBetQueryResultSchema,
  BucksBetQuerySchema,
  BucksLedgerQueryResultSchema,
  BucksLedgerQuerySchema,
} from "#src/betting/analytics/ask-analytics-schema.ts";
import {
  loadBucksAskAnalyticsDataset,
  type BucksAskAnalyticsDataset,
} from "#src/betting/analytics/ask-analytics.ts";
import {
  bucksAskDatasetOverview,
  queryBucksAccounts,
  queryBucksBets,
  queryBucksLedger,
} from "#src/betting/analytics/ask-analytics-query.ts";
import {
  isPolicyEnabled,
  listGuildsWithFlagEnabled,
} from "#src/configuration/flags.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

/**
 * Bryan Bucks analytics inside the Explore agent.
 *
 * `/bb ask` used to be its own one-shot command with its own agent; the merge
 * keeps the *tools* — whose privacy guarantees are structural, not prompt-based
 * (the account tool physically sees only the asker, the ledger tool has no
 * bettor dimension) — and lets the shared Explore agent decide when a question
 * is about Bucks. The answers persist in the asker's Explore conversation like
 * any other turn, which is a deliberate product decision.
 */

export type BucksExploreCapability = {
  serverId: DiscordGuildId;
};

/**
 * Whether — and for which guild — this turn may read Bryan Bucks data.
 *
 * The sync registry pre-filter bounds Flipt evaluation to guilds that carry a
 * `betting_enabled` override at all, so the global-in-prod `/scout ask` path
 * never gains a Flipt dependency (production also hard-disables betting before
 * evaluation). A Flipt error inside the betting guild fails the turn — fail
 * fast beats silently answering "I have no such tools".
 *
 * More than one enabled guild in one turn's scope is a hard failure, matching
 * `runWeeklyBucksLeaderboard`: the single-guild assumption is load-bearing
 * until an explicit mapping exists.
 */
export async function resolveBucksCapability(
  guildIds: readonly string[],
): Promise<BucksExploreCapability | null> {
  const declared = new Set<string>(
    listGuildsWithFlagEnabled("betting_enabled"),
  );
  const candidates = guildIds.filter((guildId) => declared.has(guildId));
  const enabled: DiscordGuildId[] = [];
  for (const guildId of candidates) {
    const serverId = DiscordGuildIdSchema.parse(guildId);
    if (await isPolicyEnabled("betting_enabled", { server: serverId })) {
      enabled.push(serverId);
    }
  }
  if (enabled.length === 0) {
    return null;
  }
  const serverId = enabled[0];
  if (serverId === undefined || enabled.length > 1) {
    throw new Error(
      "Bryan Bucks analysis requires exactly one enabled guild in scope; " +
        "add an explicit mapping before enabling a second guild.",
    );
  }
  return { serverId };
}

/**
 * The four bounded analytics tools, wrapped for the Explore loop.
 *
 * The dataset is loaded lazily on the first Bucks call and memoized as a
 * promise for the rest of the turn: most Explore turns in the betting guild
 * are still match questions, and the RepeatableRead snapshot of up to 100k
 * ledger rows should not be paid for on every one of them. Calls route through
 * the shared `ToolTracker`, so they consume the same tool budget and metrics
 * as every other Explore tool.
 */
export type BucksExploreToolsInput = {
  capability: BucksExploreCapability;
  requesterId: DiscordAccountId;
  track: ToolTracker;
  /** Test seam; production always reads the real snapshot. */
  loadDataset?: (serverId: DiscordGuildId) => Promise<BucksAskAnalyticsDataset>;
};

/**
 * The tools' executors, separate from the AI-SDK `tool()` wrappers so tests
 * can drive them without constructing a `ToolExecutionOptions`.
 */
export function createBucksToolExecutors(input: BucksExploreToolsInput) {
  const load = input.loadDataset ?? loadBucksAskAnalyticsDataset;
  let datasetPromise: Promise<BucksAskAnalyticsDataset> | null = null;
  const dataset = (): Promise<BucksAskAnalyticsDataset> => {
    datasetPromise ??= load(input.capability.serverId);
    return datasetPromise;
  };

  return {
    getDataset: () =>
      input.track("get_bucks_dataset", async () =>
        BucksAskDatasetOverviewSchema.parse(
          bucksAskDatasetOverview(await dataset()),
        ),
      ),
    queryAccounts: (inputData: unknown) =>
      input.track("query_bucks_accounts", async () =>
        queryBucksAccounts(
          await dataset(),
          BucksAccountQuerySchema.parse(inputData),
          input.requesterId,
        ),
      ),
    queryLedger: (inputData: unknown) =>
      input.track("query_bucks_ledger", async () =>
        queryBucksLedger(
          await dataset(),
          BucksLedgerQuerySchema.parse(inputData),
        ),
      ),
    queryBets: (inputData: unknown) =>
      input.track("query_bucks_bets", async () =>
        queryBucksBets(await dataset(), BucksBetQuerySchema.parse(inputData)),
      ),
  };
}

export function createBucksExploreTools(input: BucksExploreToolsInput) {
  const executors = createBucksToolExecutors(input);
  return {
    get_bucks_dataset: tool({
      description:
        "Describe the available Bryan Bucks dataset, overall date coverage, subjects, sample sizes, and important definitions. Its coverage is dataset-wide; never report it as a filtered query's matched coverage. Load the bryan-bucks skill first if you have not this turn.",
      inputSchema: z.strictObject({}),
      outputSchema: BucksAskDatasetOverviewSchema,
      execute: () => executors.getDataset(),
    }),
    query_bucks_accounts: tool({
      description:
        "Read only the asker's current Bryan Bucks account balance. Use this for the asker's current balance, never for another member, a leaderboard, betting profit, or earnings.",
      inputSchema: BucksAccountQuerySchema,
      outputSchema: BucksAccountQueryResultSchema,
      execute: (inputData) => executors.queryAccounts(inputData),
    }),
    query_bucks_ledger: tool({
      description:
        "Aggregate guild-wide Bryan Bucks seed grants, non-betting earnings, and adjustments by entry kind or day. Bettor filters and grouping are deliberately unavailable so ledger results cannot be combined with betting P&L to reconstruct private balances. Never call ledger delta betting P&L.",
      inputSchema: BucksLedgerQuerySchema,
      outputSchema: BucksLedgerQueryResultSchema,
      execute: (inputData) => executors.queryLedger(inputData),
    }),
    query_bucks_bets: tool({
      description:
        "Aggregate human outcome and parlay positions by position type, bettor, subject, subject result, bet direction/side, outcome, or day. Use net_bb for gross-payout-minus-stake profit/loss and sort ascending for the largest loss. staked_bb covers every matched position; gross_payout_bb, win rate, and ROI use settled won/lost positions only. Player-subject attribution applies only to outcome positions; parlays appear as multi-player.",
      inputSchema: BucksBetQuerySchema,
      outputSchema: BucksBetQueryResultSchema,
      execute: (inputData) => executors.queryBets(inputData),
    }),
  };
}
