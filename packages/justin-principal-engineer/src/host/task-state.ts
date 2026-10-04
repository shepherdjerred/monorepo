import path from "node:path";

import type { LinearIssue, Provider, TaskState } from "#src/domain/schemas.ts";
import { branchName } from "#src/host/branch-name.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";
import { currentTimestamp } from "#src/runtime/time.ts";

export function createTaskState(input: {
  issue: LinearIssue;
  provider: Provider;
  deliveryMode?: TaskState["deliveryMode"];
  paths: RuntimePaths;
}): TaskState {
  const timestamp = currentTimestamp();
  return {
    issue: input.issue,
    provider: input.provider,
    deliveryMode: input.deliveryMode ?? "owner_approved",
    repairTurnsUsed: 0,
    implementationStarted: false,
    blockedReason: null,
    nextAttemptAt: null,
    blockedAttempts: 0,
    mergeCommitSha: null,
    phase: "claiming",
    resumePhase: "claimed",
    branch: branchName(input.issue.identifier, input.issue.title),
    checkoutPath: path.join(
      input.paths.tasks,
      input.issue.identifier.toLowerCase(),
    ),
    prNumber: null,
    prUrl: null,
    latestHeadSha: null,
    lastAgentOutput: null,
    pendingFeedback: [],
    pendingHealth: null,
    pendingDiagnostics: null,
    pendingCodexFindingKeys: [],
    pendingReviewFindings: [],
    restackInProgress: false,
    evidencePublished: false,
    evidenceMarkdown: [],
    seenFeedbackIds: [],
    failureCount: 0,
    lastFailureFingerprint: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
