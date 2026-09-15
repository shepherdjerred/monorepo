import path from "node:path";

import type { LinearIssue, Provider, TaskState } from "#src/domain/schemas.ts";
import { branchName } from "#src/host/git-workspace.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";
import { currentTimestamp } from "#src/runtime/time.ts";

export function createTaskState(input: {
  issue: LinearIssue;
  provider: Provider;
  paths: RuntimePaths;
}): TaskState {
  const timestamp = currentTimestamp();
  return {
    issue: input.issue,
    provider: input.provider,
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
