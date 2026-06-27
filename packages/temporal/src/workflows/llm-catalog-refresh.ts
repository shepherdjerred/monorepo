import { proxyActivities } from "@temporalio/workflow";
import type {
  LlmCatalogRefreshActivities,
  LlmCatalogRefreshResult,
} from "#activities/llm-catalog-refresh.ts";

const { refreshLlmCatalog } = proxyActivities<LlmCatalogRefreshActivities>({
  // Long: clones the monorepo, installs the catalog package, runs the
  // deterministic upstream cross-check, and opens a PR on drift. Heartbeats
  // fire every 10s so worker death surfaces in <60s. 20 min leaves room for a
  // retry inside the 30-min workflowExecutionTimeout.
  startToCloseTimeout: "20 minutes",
  heartbeatTimeout: "60 seconds",
  retry: {
    maximumAttempts: 2,
    initialInterval: "2 minutes",
    backoffCoefficient: 2,
    maximumInterval: "10 minutes",
  },
});

export async function runLlmCatalogRefresh(): Promise<LlmCatalogRefreshResult> {
  return await refreshLlmCatalog();
}
