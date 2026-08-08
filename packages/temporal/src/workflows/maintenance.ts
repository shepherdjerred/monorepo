import { proxyActivities } from "@temporalio/workflow";
import type { MaintenanceActivities } from "#activities/maintenance.ts";

const maintenanceActivityOptions = {
  heartbeatTimeout: "90 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "30s",
    backoffCoefficient: 2,
    maximumInterval: "5 minutes",
  },
} as const;

const { runKometa, runUvCachePrune, runTrivyDbRefresh } =
  proxyActivities<MaintenanceActivities>({
    ...maintenanceActivityOptions,
    startToCloseTimeout: "30 minutes",
  });
const { runBunCacheGc } = proxyActivities<MaintenanceActivities>({
  ...maintenanceActivityOptions,
  startToCloseTimeout: "15 minutes",
});

export async function runKometaWorkflow(): Promise<void> {
  await runKometa();
}

export async function runBunCacheGcWorkflow(): Promise<void> {
  await runBunCacheGc();
}

export async function runUvCachePruneWorkflow(): Promise<void> {
  await runUvCachePrune();
}

export async function runTrivyDbRefreshWorkflow(): Promise<void> {
  await runTrivyDbRefresh();
}
