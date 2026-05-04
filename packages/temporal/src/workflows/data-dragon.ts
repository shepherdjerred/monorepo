import { proxyActivities } from "@temporalio/workflow";
import type {
  DataDragonActivities,
  DataDragonUpdateMode,
  DataDragonUpdateResult,
} from "#activities/data-dragon.ts";

const { getDataDragonVersionState, recordDataDragonSkipped } =
  proxyActivities<DataDragonActivities>({
    // Quick HTTP fetch + Zod parse — finishes in seconds.
    startToCloseTimeout: "1 minute",
    retry: {
      maximumAttempts: 3,
      initialInterval: "30 seconds",
      backoffCoefficient: 2,
      maximumInterval: "2 minutes",
    },
  });

const { updateDataDragon } = proxyActivities<DataDragonActivities>({
  // Long: clones the monorepo, runs `bun install --frozen-lockfile`,
  // downloads ~3500 image assets in batches, refreshes the workspace
  // install, runs snapshot tests, commits + pushes + opens a PR.
  // Heartbeats fire every 10s (see data-dragon.ts) so worker death
  // surfaces in <60s.
  startToCloseTimeout: "90 minutes",
  heartbeatTimeout: "60 seconds",
  retry: {
    maximumAttempts: 2,
    initialInterval: "5 minutes",
    backoffCoefficient: 2,
    maximumInterval: "15 minutes",
  },
});

export async function runScoutDataDragonUpdate(
  mode: DataDragonUpdateMode,
): Promise<DataDragonUpdateResult | undefined> {
  const state = await getDataDragonVersionState();

  if (mode === "version-check" && !state.updateRequired) {
    await recordDataDragonSkipped({ ...state, mode });
    return undefined;
  }

  return await updateDataDragon({ ...state, mode });
}
