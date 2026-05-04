import { proxyActivities } from "@temporalio/workflow";
import type { DepsSummaryActivities } from "#activities/deps-summary.ts";

const RETRY = {
  maximumAttempts: 3,
  initialInterval: "30 seconds" as const,
  backoffCoefficient: 2,
  maximumInterval: "5 minutes" as const,
};

// Long-ish activities that benefit from heartbeats: shallow-clone the
// homelab repo, fetch release notes from GitHub, summarise via OpenAI.
// Heartbeats fire every 10s (see deps-summary.ts).
const { cloneAndGetVersionChanges } = proxyActivities<DepsSummaryActivities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "60 seconds",
  retry: RETRY,
});

const { fetchReleaseNotes } = proxyActivities<DepsSummaryActivities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "60 seconds",
  retry: RETRY,
});

const { summarizeWithLLM } = proxyActivities<DepsSummaryActivities>({
  // One OpenAI completion call.
  startToCloseTimeout: "3 minutes",
  retry: RETRY,
});

const { formatAndSendEmail } = proxyActivities<DepsSummaryActivities>({
  // Synchronous Postal API call.
  startToCloseTimeout: "1 minute",
  retry: RETRY,
});

export async function generateDependencySummary(daysBack = 7): Promise<void> {
  const changes = await cloneAndGetVersionChanges(daysBack);

  if (changes.length === 0) {
    await formatAndSendEmail([], "", []);
    return;
  }

  const releaseNotesResult = await fetchReleaseNotes(changes);
  const summary = await summarizeWithLLM(changes, releaseNotesResult.notes);
  await formatAndSendEmail(changes, summary, releaseNotesResult.failed);
}
