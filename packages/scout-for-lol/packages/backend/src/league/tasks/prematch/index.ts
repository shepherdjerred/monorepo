import { checkActiveGames } from "#src/league/tasks/prematch/active-game-detection.ts";
import {
  abandonExpiredDareProposals,
  expireDareAcceptWindows,
} from "#src/betting/dare-sweep.ts";
import { deliverDareSummaries } from "#src/betting/dare-delivery.ts";
import type { DareSettlementSummary } from "#src/betting/dare-settle.ts";
import { closeExpiredBettingWindows } from "#src/betting/sweep.ts";
import { closeExpiredParlayWindows } from "#src/betting/parlay-sweep.ts";
import { activatePendingParlayMarkets } from "#src/betting/parlay-publish.ts";
import { refreshClosedParlayMessages } from "#src/betting/parlay-refresh.ts";
import { refreshClosedBucksMessages } from "#src/betting/message-refresh.ts";
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
    await checkActiveGames();

    if (!isFeatureHardDisabled("betting_enabled")) {
      // Durable publishing rows are a small outbox: retry Discord activation
      // before processing clocks, including after a restart between persistence
      // and the message edit that exposes buttons.
      await activatePendingParlayMarkets();

      // Grey out the buttons on windows that have just expired. Purely cosmetic:
      // a click on a live-looking button is still refused by placeBet, which
      // re-checks closesAt inside its transaction.
      const closed = await closeExpiredBettingWindows();
      await refreshClosedBucksMessages(closed);
      const closedParlays = await closeExpiredParlayWindows();
      await refreshClosedParlayMessages(closedParlays);

      // Dare clocks: unconfirmed proposals past their TTL and accept windows
      // nobody answered. Both swallow per-record errors. Delivery runs after
      // the refunds committed and swallows per-summary, so a dead channel can
      // never re-run or block a refund.
      dareSummaries.push(...(await abandonExpiredDareProposals()));
      dareSummaries.push(...(await expireDareAcceptWindows()));
      await deliverDareSummaries(dareSummaries);
    }

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
