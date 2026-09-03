import { retryPendingBucksEarnings } from "#src/betting/earnings-retry.ts";
import { settleEndedDareWindows } from "#src/betting/dare-sweep.ts";
import { settleEndedDareV2Windows } from "#src/betting/dare-sweep-v2.ts";
import { settleMatureDareSqlV3Races } from "#src/betting/dare-settle-v3.ts";
import { activatePendingDaresV3 } from "#src/betting/dare-activation-v3.ts";
import { refreshPendingDareV2Callouts } from "#src/betting/dare-callout-v2.ts";
import { DareV2PartialSettlementError } from "#src/betting/dare-settle-types-v2.ts";
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
import { deliverPendingDareNotifications } from "#src/betting/dare-notification-delivery.ts";
import {
  markPostMatchPollCompleted,
  markPostMatchPollFailed,
} from "#src/league/tasks/recovery/app-state.ts";
import { prisma } from "#src/database/index.ts";

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
    let evidenceComplete = false;
    let evidenceWatermark: Date | undefined;
    try {
      ({ evidenceComplete, evidenceWatermark } = await checkMatchHistory());
    } catch (error) {
      matchHistoryError = error;
      logger.error(
        bettingHardDisabled
          ? "❌ Match history polling failed:"
          : "❌ Match history polling failed; running Bryan Bucks recovery anyway:",
        error,
      );
    }
    let maintenanceError: unknown;
    let dareSummaries: DareSettlementSummary[] = [];
    try {
      ({ dareSummaries } = await runPostMatchMaintenance({
        settleDareV2Deadlines: evidenceComplete,
        dareEvidenceWatermark: evidenceWatermark,
      }));
    } catch (error) {
      maintenanceError = error;
    }

    if (matchHistoryError !== undefined && maintenanceError !== undefined) {
      throw new AggregateError(
        [matchHistoryError, maintenanceError],
        "Post-match polling and Bryan Bucks recovery both failed",
      );
    }
    if (matchHistoryError !== undefined) {
      throw asError(matchHistoryError, "Match history polling failed");
    }
    if (maintenanceError !== undefined) {
      throw asError(maintenanceError, "Bryan Bucks recovery failed");
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

export async function runPostMatchMaintenance(options?: {
  settleDareV2Deadlines: boolean;
  dareEvidenceWatermark?: Date | undefined;
}): Promise<{
  dareSummaries: DareSettlementSummary[];
}> {
  const bettingHardDisabled = isFeatureHardDisabled("betting_enabled");
  let dareSummaries: DareSettlementSummary[] = [];
  const settleDareV2Deadlines = options?.settleDareV2Deadlines ?? true;
  // Dare v2 recovery is never feature-gated. Once a contract is funded its
  // settlement and refund paths must survive both rollout revocation and the
  // broader Bryan Bucks hard-disable. Other betting maintenance remains
  // behind the hard-disable policy.
  const steps = [
    {
      name: "dare activation",
      run: async () => {
        await activatePendingDaresV3();
      },
    },
    {
      name: "dare race finality",
      run: async () => {
        if (
          settleDareV2Deadlines &&
          options?.dareEvidenceWatermark !== undefined
        ) {
          await settleMatureDareSqlV3Races(
            prisma,
            options.dareEvidenceWatermark,
          );
        }
      },
    },
    {
      name: "dare v2 deadline settle",
      run: async () => {
        try {
          if (settleDareV2Deadlines) {
            await settleEndedDareV2Windows(
              undefined,
              options?.dareEvidenceWatermark,
            );
          }
          await refreshPendingDareV2Callouts();
        } catch (error) {
          if (error instanceof DareV2PartialSettlementError) {
            await refreshPendingDareV2Callouts();
          }
          throw error;
        }
      },
    },
    {
      name: "dare notification delivery",
      run: async () => {
        await deliverPendingDareNotifications();
      },
    },
  ];
  if (!bettingHardDisabled) {
    steps.push(
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
    );
  }
  // Isolated per step, then re-thrown: a persistently failing recovery path
  // cannot starve the remaining clocks while money stays escrowed.
  try {
    await runMaintenanceSteps("post-match maintenance", steps);
    await markPostMatchPollCompleted({
      completedAt: new Date(),
      evidenceComplete: settleDareV2Deadlines,
      evidenceWatermark: options?.dareEvidenceWatermark,
    });
  } catch (error) {
    await markPostMatchPollFailed(error, new Date());
    throw error;
  }
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
