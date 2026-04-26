import { proxyActivities } from "@temporalio/workflow";
import type {
  DataDragonActivities,
  DataDragonUpdateMode,
  DataDragonUpdateResult,
} from "#activities/data-dragon.ts";

const { getDataDragonVersionState, recordDataDragonSkipped, updateDataDragon } =
  proxyActivities<DataDragonActivities>({
    startToCloseTimeout: "2 hours",
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
