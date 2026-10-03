import {
  checkActiveGames,
  type PrematchV2CaptureCheck,
} from "#src/league/tasks/prematch/active-game-detection.ts";
import { deleteExpiredActiveGames } from "#src/league/tasks/prematch/active-game-queries.ts";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settlement-types.ts";
import {
  runMaintenanceSteps,
  type MaintenanceStep,
} from "#src/league/tasks/maintenance-steps.ts";
import { prematchMaintenanceSteps } from "#src/temporal/v2/prematch/prematch-maintenance.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("tasks-prematch");

/**
 * Who detects live games in this pass.
 *
 * `v1` is the whole v1 pass: this process detects, announces and opens
 * markets, skipping any game the V2 prematch path already took. `v2` means
 * `scoutPrematchDiscoveryV2Workflow` already detected this pass's games, so
 * only the rest of the prematch maintenance runs here, plus the `ActiveGame`
 * expiry detection would otherwise have done.
 */
export type PrematchPassDetection =
  | { activeGameDetection: "v1"; capturedByV2: PrematchV2CaptureCheck }
  | { activeGameDetection: "v2" };

function detectionStep(pass: PrematchPassDetection): MaintenanceStep {
  if (pass.activeGameDetection === "v2") {
    return {
      name: "active-game expiry",
      run: async () => {
        await deleteExpiredActiveGames();
      },
    };
  }
  return {
    name: "active-game detection",
    run: async () => {
      await checkActiveGames({ capturedByV2: pass.capturedByV2 });
    },
  };
}

export async function checkPreMatch(pass: PrematchPassDetection): Promise<{
  dareSummaries: DareSettlementSummary[];
}> {
  logger.info("🎯 Starting pre-match check task");
  const startTime = Date.now();
  const dareSummaries: DareSettlementSummary[] = [];

  try {
    // Every step runs even when an earlier one throws, and the collected
    // failures are re-thrown at the end. The sweeps after detection are the
    // V2 poll's own maintenance pass (`prematchMaintenanceSteps`), so the two
    // paths run one list.
    const steps: MaintenanceStep[] = [
      detectionStep(pass),
      ...prematchMaintenanceSteps(dareSummaries),
    ];
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
