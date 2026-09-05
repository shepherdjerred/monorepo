import { checkActiveGames } from "#src/league/tasks/prematch/active-game-detection.ts";
import {
  abandonExpiredDareProposals,
  expireDareAcceptWindows,
} from "#src/betting/dares/settlement/dare-sweep.ts";
import { deliverDareSummaries } from "#src/betting/dares/presentation/dare-delivery.ts";
import { expireDareV2AcceptWindows } from "#src/betting/dares/settlement/dare-sweep-v2.ts";
import { refreshPendingDareV2Callouts } from "#src/betting/dares/presentation/dare-callout-v2.ts";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settle-shared.ts";
import { closeExpiredBettingWindows } from "#src/betting/settlement/sweep.ts";
import { closeExpiredParlayWindows } from "#src/betting/parlays/parlay-sweep.ts";
import { activatePendingParlayMarkets } from "#src/betting/parlays/parlay-publish.ts";
import { refreshClosedParlayMessages } from "#src/betting/parlays/parlay-refresh.ts";
import { refreshClosedBucksMessages } from "#src/betting/message-refresh.ts";
import {
  runMaintenanceSteps,
  type MaintenanceStep,
} from "#src/league/tasks/maintenance-steps.ts";
import { createLogger } from "#src/logger.ts";
import { isFeatureHardDisabled } from "#src/configuration/flags.ts";

const logger = createLogger("tasks-prematch");

export async function checkPreMatch(): Promise<{
  dareSummaries: DareSettlementSummary[];
}> {
  logger.info("🎯 Starting pre-match check task");
  const startTime = Date.now();
  const dareSummaries: DareSettlementSummary[] = [];

  try {
    // Every step runs even when an earlier one throws, and the collected
    // failures are re-thrown at the end. Dare v2 recovery is outside every
    // feature flag so a rollout revocation cannot strand funded contracts.
    const steps: MaintenanceStep[] = [
      {
        name: "active-game detection",
        run: async () => {
          await checkActiveGames();
        },
      },
      {
        name: "dare v2 accept-window expiry",
        run: async () => {
          await expireDareV2AcceptWindows();
          await refreshPendingDareV2Callouts();
        },
      },
    ];
    if (!isFeatureHardDisabled("betting_enabled")) {
      steps.push(
        {
          // Durable publishing rows are a small outbox: retry Discord
          // activation before processing clocks, including after a restart
          // between persistence and the message edit that exposes buttons.
          name: "parlay market activation",
          run: async () => {
            await activatePendingParlayMarkets();
          },
        },
        {
          // Grey out the buttons on windows that have just expired. Purely
          // cosmetic: a click on a live-looking button is still refused by
          // placeBet, which re-checks closesAt inside its transaction.
          name: "betting window close",
          run: async () => {
            await refreshClosedBucksMessages(
              await closeExpiredBettingWindows(),
            );
          },
        },
        {
          name: "parlay window close",
          run: async () => {
            await refreshClosedParlayMessages(
              await closeExpiredParlayWindows(),
            );
          },
        },
        {
          // Unconfirmed proposals past their TTL. Swallows per-record errors.
          name: "dare proposal TTL",
          run: async () => {
            dareSummaries.push(...(await abandonExpiredDareProposals()));
          },
        },
        {
          // Accept windows nobody answered — a refund path, kept in its own
          // step so the proposal sweep above can never starve it.
          name: "dare accept-window expiry",
          run: async () => {
            dareSummaries.push(...(await expireDareAcceptWindows()));
          },
        },
        {
          // Delivery runs after the refunds committed and swallows
          // per-summary, so a dead channel can never re-run or block a refund.
          name: "dare summary delivery",
          run: async () => {
            await deliverDareSummaries(dareSummaries);
          },
        },
      );
    }
    await runMaintenanceSteps("pre-match check", steps);

    const executionTime = Date.now() - startTime;
    logger.info(
      `✅ Pre-match check completed successfully in ${executionTime.toString()}ms`,
    );
    return { dareSummaries };
  } catch (error) {
    const executionTime = Date.now() - startTime;
    logger.error(
      `❌ Pre-match check failed after ${executionTime.toString()}ms:`,
      error,
    );
    throw error;
  }
}
