import { log, proxyActivities } from "@temporalio/workflow";
import type { CiWorkspaceReaperActivities } from "#activities/maintenance/ci-workspace-reaper.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

/**
 * Deletes Woodpecker step pods and workspace claims that outlived every
 * workflow that could own them. The Activity runs on the infra queue, whose
 * worker holds the namespace-scoped delete grant in woodpecker-ci; the CI
 * maintenance worker in that namespace stays tokenless.
 */
const { reapLeakedCiWorkspaces } = proxyActivities<CiWorkspaceReaperActivities>(
  {
    taskQueue: TASK_QUEUES.INFRA,
    // Two list calls and at most CI_WORKSPACE_REAP_LIMIT deletes of each kind,
    // heartbeating after every delete.
    startToCloseTimeout: "5 minutes",
    heartbeatTimeout: "1 minute",
    retry: {
      maximumAttempts: 3,
      initialInterval: "30s",
      backoffCoefficient: 2,
      maximumInterval: "2 minutes",
    },
  },
);

export async function runCiWorkspaceReaperWorkflow(): Promise<void> {
  const result = await reapLeakedCiWorkspaces();
  log.info("CI workspace reap complete", {
    deletedPods: result.deletedPods.length,
    deletedClaims: result.deletedClaims.length,
    skipped: result.skipped.length,
    deferredPods: result.deferredPods,
    deferredClaims: result.deferredClaims,
    mountedClaims: result.mountedClaims.length,
  });
}
