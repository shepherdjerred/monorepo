import { retryPendingBucksEarnings } from "#src/betting/accounts/earnings-retry.ts";
import { settleEndedDareWindows } from "#src/betting/dares/settlement/dare-sweep.ts";
import { settleMatureDareSqlRaces } from "#src/betting/dares/settlement/dare-settle-contract.ts";
import { activatePendingDares } from "#src/betting/dares/lifecycle/dare-activation.ts";
import { refreshPendingDareCallouts } from "#src/betting/dares/presentation/dare-callout.ts";
import { DarePartialSettlementError } from "#src/betting/dares/settlement/dare-settle-types.ts";
import { checkMatchHistory } from "#src/league/tasks/postmatch/match-history-polling.ts";
import { voidStaleAndAnnounce } from "#src/league/tasks/postmatch/void-stale-announce.ts";
import { voidStaleParlayMarkets } from "#src/betting/parlays/runtime/parlay-sweep.ts";
import { runMaintenanceSteps } from "#src/league/tasks/maintenance-steps.ts";
import { createLogger } from "#src/logger.ts";
import { isFeatureHardDisabled } from "#src/configuration/flags.ts";
import { deliverPendingDareNotifications } from "#src/betting/dares/presentation/notify/dare-notification-delivery.ts";
import {
  markPostMatchPollCompleted,
  markPostMatchPollFailed,
  type PostMatchPollOwner,
} from "#src/league/tasks/recovery/app-state.ts";
import { prisma } from "#src/database/index.ts";

const logger = createLogger("tasks-postmatch");

function asError(error: unknown, message: string): Error {
  return error instanceof Error ? error : new Error(message, { cause: error });
}

export async function checkPostMatch(): Promise<void> {
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
    try {
      await runPostMatchMaintenance({
        settleDareV2Deadlines: evidenceComplete,
        dareEvidenceWatermark: evidenceWatermark,
      });
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
  } catch (error) {
    const executionTime = Date.now() - startTime;
    logger.error(
      `❌ Post-match check failed after ${executionTime.toString()}ms:`,
      error,
    );
    throw error;
  }
}

/**
 * Run the post-match clocks and close the poll.
 *
 * `pollOwner` is the poll this pass may close, present only when the caller
 * claimed one durably — a V2 discovery, whose poll spans the Workflow rather
 * than one Activity. The close is then guarded on that identity: a run whose
 * claim was taken over closes nothing and fails loudly, rather than marking a
 * LATER run's poll complete underneath it. Without it the close overwrites
 * whatever stands, which is v1's behaviour and stays v1's behaviour.
 */
export async function runPostMatchMaintenance(options?: {
  settleDareV2Deadlines: boolean;
  dareEvidenceWatermark?: Date | undefined;
  pollOwner?: PostMatchPollOwner | undefined;
}): Promise<void> {
  const bettingHardDisabled = isFeatureHardDisabled("betting_enabled");
  const settleDareV2Deadlines = options?.settleDareV2Deadlines ?? true;
  // Dare recovery is never feature-gated. Once a contract is funded its
  // settlement and refund paths must survive both rollout revocation and the
  // broader Bryan Bucks hard-disable. Other betting maintenance remains
  // behind the hard-disable policy.
  const steps = [
    {
      name: "dare activation",
      run: async () => {
        await activatePendingDares();
      },
    },
    {
      name: "dare race finality",
      run: async () => {
        if (
          settleDareV2Deadlines &&
          options?.dareEvidenceWatermark !== undefined
        ) {
          await settleMatureDareSqlRaces(prisma, options.dareEvidenceWatermark);
        }
      },
    },
    {
      name: "dare deadline settle",
      run: async () => {
        try {
          if (settleDareV2Deadlines) {
            await settleEndedDareWindows(
              undefined,
              options?.dareEvidenceWatermark,
            );
          }
          await refreshPendingDareCallouts();
        } catch (error) {
          if (error instanceof DarePartialSettlementError) {
            await refreshPendingDareCallouts();
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
    );
  }
  const pollOwner = options?.pollOwner;
  const close = pollOwner === undefined ? {} : { owner: pollOwner };
  // Isolated per step, then re-thrown: a persistently failing recovery path
  // cannot starve the remaining clocks while money stays escrowed.
  try {
    await runMaintenanceSteps("post-match maintenance", steps);
    await markPostMatchPollCompleted({
      completedAt: new Date(),
      evidenceComplete: settleDareV2Deadlines,
      evidenceWatermark: options?.dareEvidenceWatermark,
      ...close,
    });
  } catch (error) {
    try {
      await markPostMatchPollFailed(error, new Date(), close);
    } catch (closeError) {
      // Both facts matter and neither may hide the other: the clocks failed,
      // AND the poll this run meant to close was no longer its own. Reporting
      // only the first would lose a durable-write conflict; reporting only the
      // second would lose why maintenance failed at all.
      throw new AggregateError(
        [error, closeError],
        "Post-match maintenance failed and its poll was no longer this run's to close",
        { cause: closeError },
      );
    }
    throw error;
  }
}
