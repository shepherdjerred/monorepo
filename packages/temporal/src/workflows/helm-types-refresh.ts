import { proxyActivities } from "@temporalio/workflow";
import type {
  HelmTypesRefreshActivities,
  HelmTypesRefreshResult,
} from "#activities/helm-types-refresh.ts";

const { refreshHelmTypes } = proxyActivities<HelmTypesRefreshActivities>({
  // Long: clones the monorepo, installs deps, regenerates ~24 chart type files
  // (each a `helm pull`), and opens a PR on drift. Heartbeats fire every 10s
  // (see activities/helm-types-refresh.ts) so worker death surfaces in <60s.
  // 20 min (not 30) so a failed first attempt has room to retry within the
  // 30-min workflowExecutionTimeout (2-min initialInterval + second attempt).
  startToCloseTimeout: "20 minutes",
  heartbeatTimeout: "60 seconds",
  retry: {
    maximumAttempts: 2,
    initialInterval: "2 minutes",
    backoffCoefficient: 2,
    maximumInterval: "10 minutes",
  },
});

export async function runHelmTypesRefresh(): Promise<HelmTypesRefreshResult> {
  return await refreshHelmTypes();
}
