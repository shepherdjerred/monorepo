import { proxyActivities } from "@temporalio/workflow";
import type {
  PokeemeraldDataRefreshActivities,
  PokeemeraldDataRefreshResult,
} from "#activities/dpp-pokeemerald-data-refresh.ts";

const { refreshPokeemeraldData } =
  proxyActivities<PokeemeraldDataRefreshActivities>({
    // Clones the monorepo, does the workspace install, fetches four small
    // files from raw.githubusercontent.com, and opens a PR on drift.
    // Heartbeats fire every 10s (see
    // activities/dpp-pokeemerald-data-refresh.ts) so worker death surfaces in
    // <60s. 10 min leaves room for a second attempt inside the 30-min
    // workflowExecutionTimeout.
    startToCloseTimeout: "10 minutes",
    heartbeatTimeout: "60 seconds",
    retry: {
      maximumAttempts: 2,
      initialInterval: "2 minutes",
      backoffCoefficient: 2,
      maximumInterval: "10 minutes",
    },
  });

export async function runPokeemeraldDataRefresh(): Promise<PokeemeraldDataRefreshResult> {
  return await refreshPokeemeraldData();
}
