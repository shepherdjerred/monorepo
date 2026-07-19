import { proxyActivities } from "@temporalio/workflow";
import type {
  ScoutShowcaseRefreshActivities,
  ScoutShowcaseRefreshResult,
} from "#activities/scout-showcase-refresh.ts";

const { refreshScoutShowcase } =
  proxyActivities<ScoutShowcaseRefreshActivities>({
    // Clones the monorepo, does the root + scout workspace installs (the
    // heavy part), downloads the manifest's S3 objects, renders the discord
    // composites, and opens a PR on drift. Heartbeats fire every 10s (see
    // activities/scout-showcase-refresh.ts) so worker death surfaces in
    // <60s. 25 min leaves room for a second attempt inside the 60-min
    // workflowExecutionTimeout.
    startToCloseTimeout: "25 minutes",
    heartbeatTimeout: "60 seconds",
    retry: {
      maximumAttempts: 2,
      initialInterval: "2 minutes",
      backoffCoefficient: 2,
      maximumInterval: "10 minutes",
    },
  });

export async function runScoutShowcaseRefresh(): Promise<ScoutShowcaseRefreshResult> {
  return await refreshScoutShowcase();
}
