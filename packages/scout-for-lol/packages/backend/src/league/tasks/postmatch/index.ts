import { retryPendingBucksEarnings } from "#src/betting/earnings-retry.ts";
import { settleEndedDareWindows } from "#src/betting/dare-sweep.ts";
import { deliverDareSummaries } from "#src/betting/dare-delivery.ts";
import type { DareSettlementSummary } from "#src/betting/dare-settle-shared.ts";
import { checkMatchHistory } from "#src/league/tasks/postmatch/match-history-polling.ts";
import { announceSettlements } from "#src/betting/announce.ts";
import { refreshClosedBucksMessages } from "#src/betting/message-refresh.ts";
import { voidStaleBettingPools } from "#src/betting/void-stale.ts";
import { voidStaleParlayMarkets } from "#src/betting/parlay-sweep.ts";
import { getPostmatchMessageIdsForMatchIdOrEmpty } from "#src/league/tasks/prematch/active-game-queries.ts";
import { MatchIdSchema } from "@scout-for-lol/data/index.ts";
import { runMaintenanceSteps } from "#src/league/tasks/maintenance-steps.ts";
import { createLogger } from "#src/logger.ts";
import { isFeatureHardDisabled } from "#src/configuration/flags.ts";

const logger = createLogger("tasks-postmatch");

function asError(error: unknown, message: string): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(message, { cause: error });
}

export async function checkPostMatch(): Promise<{
  dareSummaries: DareSettlementSummary[];
}> {
  logger.info("🏁 Starting post-match check task");
  const startTime = Date.now();
  const bettingHardDisabled = isFeatureHardDisabled("betting_enabled");

  try {
    let matchHistoryError: unknown;
    try {
      await checkMatchHistory();
    } catch (error) {
      matchHistoryError = error;
      logger.error(
        bettingHardDisabled
          ? "❌ Match history polling failed:"
          : "❌ Match history polling failed; running Bryan Bucks recovery anyway:",
        error,
      );
    }
    if (bettingHardDisabled) {
      if (matchHistoryError !== undefined) {
        throw asError(matchHistoryError, "Match history polling failed");
      }
      const executionTime = Date.now() - startTime;
      logger.info(
        `✅ Post-match check completed successfully in ${executionTime.toString()}ms`,
      );
      return { dareSummaries: [] };
    }

    let earningsRecoveryError: unknown;
    let dareSummaries: DareSettlementSummary[] = [];
    try {
      ({ dareSummaries } = await runPostMatchMaintenance());
    } catch (error) {
      earningsRecoveryError = error;
    }

    if (
      matchHistoryError !== undefined &&
      earningsRecoveryError !== undefined
    ) {
      throw new AggregateError(
        [matchHistoryError, earningsRecoveryError],
        "Post-match polling and Bryan Bucks recovery both failed",
      );
    }
    if (matchHistoryError !== undefined) {
      throw asError(matchHistoryError, "Match history polling failed");
    }
    if (earningsRecoveryError !== undefined) {
      throw asError(earningsRecoveryError, "Bryan Bucks recovery failed");
    }

    const executionTime = Date.now() - startTime;
    logger.info(
      `✅ Post-match check completed successfully in ${executionTime.toString()}ms`,
    );
    return { dareSummaries };
  } catch (error) {
    const executionTime = Date.now() - startTime;
    logger.error(
      `❌ Post-match check failed after ${executionTime.toString()}ms:`,
      error,
    );
    throw error;
  }
}

export async function runPostMatchMaintenance(): Promise<{
  dareSummaries: DareSettlementSummary[];
}> {
  if (isFeatureHardDisabled("betting_enabled")) {
    return { dareSummaries: [] };
  }

  let dareSummaries: DareSettlementSummary[] = [];
  // Isolated per step, then re-thrown: the dare window settle is LAST, and
  // without isolation a persistently failing earnings retry or stale-pool
  // announce would starve those refunds while the money stayed escrowed.
  await runMaintenanceSteps("post-match maintenance", [
    {
      name: "pending earnings retry",
      run: async () => {
        await retryPendingBucksEarnings();
      },
    },
    { name: "stale betting pool void", run: voidStaleAndAnnounce },
    {
      name: "stale parlay market void",
      run: async () => {
        await voidStaleParlayMarkets();
      },
    },
    {
      // Ended dare windows settle unachieved here, beside the other post-match
      // clocks.
      name: "dare window settle",
      run: async () => {
        dareSummaries = await settleEndedDareWindows();
      },
    },
    {
      // Delivery runs after the refunds committed and swallows per-summary, so
      // a dead channel never blocks or re-runs a settlement.
      name: "dare summary delivery",
      run: async () => {
        await deliverDareSummaries(dareSummaries);
      },
    },
  ]);
  return { dareSummaries };
}

/** Void pools whose match never resolved, then refresh and announce them —
 * one step because the announce consumes the void's own result. */
async function voidStaleAndAnnounce(): Promise<void> {
  const staleBucks = await voidStaleBettingPools();
  const staleMatchIds = new Set([
    ...staleBucks.closures.map((closure) => closure.matchId),
    ...staleBucks.settlements.map((settlement) => settlement.matchId),
  ]);
  await refreshClosedBucksMessages([
    ...staleBucks.closures,
    ...staleBucks.settlements,
  ]);
  for (const matchId of staleMatchIds) {
    const parsedMatchId = MatchIdSchema.safeParse(matchId);
    const postmatchMessageIds = parsedMatchId.success
      ? await getPostmatchMessageIdsForMatchIdOrEmpty(parsedMatchId.data)
      : new Map<string, string>();
    await announceSettlements({
      matchId,
      closures: staleBucks.closures.filter(
        (closure) => closure.matchId === matchId,
      ),
      settlements: staleBucks.settlements.filter(
        (settlement) => settlement.matchId === matchId,
      ),
      parlaySettlements: [],
      earnings: [],
      postmatchMessageIds,
    });
  }
}
