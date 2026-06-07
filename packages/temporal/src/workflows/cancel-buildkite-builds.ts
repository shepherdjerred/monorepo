import { proxyActivities } from "@temporalio/workflow";
import type { CancelBuildkiteBuildsActivities } from "#activities/cancel-buildkite-builds.ts";
import type { CancelBuildkiteBuildsInput } from "#shared/schemas.ts";

const { cancelBuildkiteBuildsForBranch } =
  proxyActivities<CancelBuildkiteBuildsActivities>({
    startToCloseTimeout: "2 minutes",
    retry: {
      maximumAttempts: 5,
      initialInterval: "2s",
      backoffCoefficient: 2,
      maximumInterval: "30s",
    },
  });

/**
 * Cancel any still-active Buildkite builds for a closed/merged PR's branch.
 * Started by the GitHub webhook on the `closed` action — see
 * src/event-bridge/github-webhook.ts.
 */
export async function cancelBuildkiteBuildsWorkflow(
  input: CancelBuildkiteBuildsInput,
): Promise<void> {
  await cancelBuildkiteBuildsForBranch(input);
}
