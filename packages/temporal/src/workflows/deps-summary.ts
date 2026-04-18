import { proxyActivities } from "@temporalio/workflow";
import type { DepsSummaryActivities } from "#activities/deps-summary.ts";

const {
  cloneAndGetVersionChanges,
  fetchReleaseNotes,
  summarizeWithLLM,
  formatAndSendEmail,
} = proxyActivities<DepsSummaryActivities>({
  startToCloseTimeout: "5 minutes",
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
