import { refreshPendingDareCallouts } from "#src/dares/presentation/dare-callout.ts";
import { expireDareAcceptWindows } from "#src/dares/settlement/dare-sweep.ts";
import {
  runMaintenanceSteps,
  type MaintenanceStep,
} from "#src/league/tasks/maintenance-steps.ts";

export function prematchMaintenanceSteps(): MaintenanceStep[] {
  const steps: MaintenanceStep[] = [
    {
      name: "dare accept-window expiry",
      run: async () => {
        await expireDareAcceptWindows();
        await refreshPendingDareCallouts();
      },
    },
  ];
  return steps;
}

/**
 * Run one prematch maintenance pass.
 *
 * Every step runs even when an earlier one throws, and the collected failures
 * are re-thrown at the end, so the Activity still fails and retries while no
 * broken sweep starves the refunds behind it.
 */
export async function runPrematchMaintenance(): Promise<void> {
  await runMaintenanceSteps("prematch maintenance", prematchMaintenanceSteps());
}
