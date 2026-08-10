import { proxyActivities } from "@temporalio/workflow";
import type { MaintenanceActivities } from "#activities/maintenance.ts";

const maintenanceRetry = {
  maximumAttempts: 3,
  initialInterval: "30s",
  backoffCoefficient: 2,
  maximumInterval: "5 minutes",
} as const;

const { runKometa, runUvCachePrune, runTrivyDbRefresh } =
  proxyActivities<MaintenanceActivities>({
    heartbeatTimeout: "90 seconds",
    retry: maintenanceRetry,
    startToCloseTimeout: "30 minutes",
  });
const { runBunCacheGc } = proxyActivities<MaintenanceActivities>({
  heartbeatTimeout: "90 seconds",
  retry: maintenanceRetry,
  startToCloseTimeout: "15 minutes",
});

// The cache server may spend most of this window scanning without returning
// response bytes. Unlike the subprocess activities above, there is no useful
// progress boundary to heartbeat, so start-to-close is the sole execution
// timeout and prevents an overlapping retry while the HTTP request is live.
export const turboCacheCleanActivityOptions = {
  retry: maintenanceRetry,
  startToCloseTimeout: "5 minutes",
} as const;

const { runTurboCacheClean } = proxyActivities<MaintenanceActivities>({
  ...turboCacheCleanActivityOptions,
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

export async function runTurboCacheCleanWorkflow(): Promise<void> {
  await runTurboCacheClean();
}
