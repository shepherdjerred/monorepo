import { proxyActivities } from "@temporalio/workflow";
import type { MaintenanceActivities } from "#activities/maintenance.ts";

const { runKometa, runBunCacheGc, runUvCachePrune, runTrivyDbRefresh } =
  proxyActivities<MaintenanceActivities>({
    startToCloseTimeout: "30 minutes",
    heartbeatTimeout: "90 seconds",
    retry: {
      maximumAttempts: 3,
      initialInterval: "30s",
      backoffCoefficient: 2,
      maximumInterval: "5 minutes",
    },
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
