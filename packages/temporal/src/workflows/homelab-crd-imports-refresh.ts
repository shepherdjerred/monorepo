import { proxyActivities } from "@temporalio/workflow";
import type {
  HomelabCrdImportsRefreshActivities,
  HomelabCrdImportsRefreshResult,
} from "#activities/homelab-crd-imports-refresh.ts";

const { refreshHomelabCrdImports } =
  proxyActivities<HomelabCrdImportsRefreshActivities>({
    // Clones the monorepo, does the workspace install, runs the two cdk8s
    // imports (network + kubectl), and opens a PR on drift. Heartbeats fire
    // every 10s (see activities/homelab-crd-imports-refresh.ts) so worker
    // death surfaces in <60s. 20 min leaves room for a second attempt inside
    // the 45-min workflowExecutionTimeout.
    startToCloseTimeout: "20 minutes",
    heartbeatTimeout: "60 seconds",
    retry: {
      maximumAttempts: 2,
      initialInterval: "2 minutes",
      backoffCoefficient: 2,
      maximumInterval: "10 minutes",
    },
  });

export async function runHomelabCrdImportsRefresh(): Promise<HomelabCrdImportsRefreshResult> {
  return await refreshHomelabCrdImports();
}
