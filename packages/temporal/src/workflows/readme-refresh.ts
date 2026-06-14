import { proxyActivities } from "@temporalio/workflow";
import type {
  ReadmeRefreshActivities,
  ReadmeRefreshResult,
} from "#activities/readme-refresh.ts";

const { refreshReadmes } = proxyActivities<ReadmeRefreshActivities>({
  // Long: clones the monorepo (full blobless history), runs `cog -r` over the
  // three READMEs, and opens a PR on drift. Heartbeats fire every 10s (see
  // activities/readme-refresh.ts) so worker death surfaces in <60s. 20 min
  // (not 30) so a failed first attempt has room to retry within the 30-min
  // workflowExecutionTimeout (2-min initialInterval + second attempt).
  startToCloseTimeout: "20 minutes",
  heartbeatTimeout: "60 seconds",
  retry: {
    maximumAttempts: 2,
    initialInterval: "2 minutes",
    backoffCoefficient: 2,
    maximumInterval: "10 minutes",
  },
});

export async function runReadmeRefresh(): Promise<ReadmeRefreshResult> {
  return await refreshReadmes();
}
