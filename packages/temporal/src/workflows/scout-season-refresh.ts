import { proxyActivities } from "@temporalio/workflow";
import type {
  ScoutSeasonRefreshActivities,
  ScoutSeasonRefreshInput,
  ScoutSeasonRefreshResult,
} from "#activities/scout-season-refresh.ts";

const { runScoutSeasonRefresh } =
  proxyActivities<ScoutSeasonRefreshActivities>({
    // Long: clones the monorepo, runs `claude -p` with WebFetch/WebSearch
    // (research can take many minutes), runs `bun test`, optionally opens a
    // PR via `gh`. Heartbeats fire every 10s (see activity) so worker death
    // surfaces in <60s.
    startToCloseTimeout: "30 minutes",
    heartbeatTimeout: "60 seconds",
    retry: {
      maximumAttempts: 2,
      initialInterval: "5 minutes",
      backoffCoefficient: 2,
      maximumInterval: "15 minutes",
    },
  });

export async function runScoutSeasonRefreshWorkflow(
  input: ScoutSeasonRefreshInput = {},
): Promise<ScoutSeasonRefreshResult> {
  return await runScoutSeasonRefresh(input);
}
