import {
  deliveryIsHealthy,
  deliveryIsUnhealthy,
} from "#src/domain/delivery-health.ts";
import type { Config, PrHealth, TaskState } from "#src/domain/schemas.ts";
import { ciOperatorBlocker } from "#src/integrations/ci.ts";
import type { GitHubClient, PullRequest } from "#src/integrations/github.ts";
import type { LinearClient } from "#src/integrations/linear.ts";
import type { StateStore } from "#src/runtime/state-store.ts";
import { currentTimestamp } from "#src/runtime/time.ts";
import { AutonomousBlocker } from "#src/domain/autonomy.ts";
import type { ReviewFindingRef } from "#src/domain/schemas.ts";

type Save = (
  state: TaskState,
  phase: TaskState["phase"],
  patch?: Partial<TaskState>,
) => Promise<TaskState>;

export async function pauseForCiOperatorBlocker(input: {
  state: TaskState;
  health: PrHealth;
  pr: PullRequest;
  config: Config["woodpecker"];
  token: string;
  linear: LinearClient;
  store: TaskStore;
}): Promise<boolean> {
  const blocker = await ciOperatorBlocker({
    health: input.health,
    headSha: input.pr.headRefOid,
    config: input.config,
    token: input.token,
  });
  if (blocker === null) return false;
  if (input.state.deliveryMode === "autonomous")
    throw new AutonomousBlocker(blocker, true);
  await pauseTask({
    state: { ...input.state, latestHeadSha: input.pr.headRefOid },
    reason: blocker,
    linear: input.linear,
    store: input.store,
  });
  return true;
}

export type WithGitHub = <T>(
  work: (
    github: GitHubClient,
    env: Readonly<Record<string, string>>,
  ) => Promise<T>,
) => Promise<T>;

export async function queueUnhealthy(input: {
  state: TaskState;
  health: PrHealth;
  pr: PullRequest;
  save: Save;
  withGitHub: WithGitHub;
}): Promise<boolean> {
  if (!deliveryIsUnhealthy(input.health)) return false;
  const diagnostics = await collectDiagnostics({
    prNumber: input.pr.number,
    health: input.health,
    checkout: input.state.checkoutPath,
    withGitHub: input.withGitHub,
    headSha: input.pr.headRefOid,
  });
  const failures =
    input.health.checks
      .find((check) => check.name === "CI Status")
      ?.details.filter((detail) =>
        /^(?:Workflow|GitHub check) "/.test(detail),
      ) ?? [];
  const reviewOnlyFailure =
    failures.length > 0 &&
    failures.every((detail) =>
      /^Workflow "review-gate" - (?:FAILURE|ERROR)$/.test(detail),
    );
  if (
    reviewOnlyFailure &&
    input.state.deliveryMode === "autonomous" &&
    diagnostics.reviewFindings.length === 0 &&
    diagnostics.blockedReasons.length > 0
  )
    throw new AutonomousBlocker(
      `Automated review is blocked: ${diagnostics.blockedReasons.join(", ")}`,
      true,
    );
  await input.save(input.state, "implementing", {
    pendingHealth: input.health,
    pendingDiagnostics: diagnostics.text,
    pendingCodexFindingKeys: diagnostics.findingKeys,
    pendingReviewFindings: diagnostics.reviewFindings,
    latestHeadSha: input.pr.headRefOid,
  });
  return true;
}

export async function completeNoChangeTurn(input: {
  state: TaskState;
  output: NonNullable<TaskState["lastAgentOutput"]>;
  linear: LinearClient;
  save: Save;
  writeInfo: (message: string) => void;
}): Promise<void> {
  const completing = await input.save(input.state, "completing", {
    lastAgentOutput: input.output,
    pendingFeedback: [],
    pendingHealth: null,
    pendingDiagnostics: null,
    pendingCodexFindingKeys: [],
  });
  await completeTask({
    state: completing,
    linear: input.linear,
    save: input.save,
    writeInfo: input.writeInfo,
  });
}

export async function mergeTask(input: {
  state: TaskState;
  withGitHub: WithGitHub;
  linear: LinearClient;
  save: Save;
  writeInfo: (message: string) => void;
  ready?: () => Promise<boolean>;
  mergeCommand?: readonly string[];
  confirmMerged?: (
    sha: string,
    env: Readonly<Record<string, string>>,
  ) => Promise<void>;
}): Promise<void> {
  const { state } = input;
  if (state.prNumber === null || state.prUrl === null) {
    throw new Error("Merging task has no PR");
  }
  const prNumber = state.prNumber;
  await input.withGitHub(async (github, env) => {
    let pr: PullRequest = await github.pullRequest(prNumber);
    if (pr.mergedAt === null) {
      const health = await github.health(pr.number, state.checkoutPath);
      const approved =
        state.deliveryMode === "autonomous" ||
        (await github.hasExactHeadApproval(pr.number, pr.headRefOid));
      if (!approved || !deliveryIsHealthy(health)) {
        await input.save(state, "awaiting_ci", {
          latestHeadSha: pr.headRefOid,
        });
        return;
      }
      const feedback = await github.feedback(
        prNumber,
        new Set(state.seenFeedbackIds),
      );
      if (feedback.length > 0) {
        await input.save(state, "implementing", {
          pendingFeedback: feedback,
          pendingHealth: null,
          pendingDiagnostics: null,
          latestHeadSha: pr.headRefOid,
        });
        input.writeInfo(
          `${state.issue.identifier}: new owner feedback arrived before merge`,
        );
        return;
      }
      if (input.ready === undefined || input.mergeCommand === undefined)
        throw new Error("Merge requires the host readiness hook");
      if (!(await input.ready())) {
        await input.save(state, "awaiting_ci", {
          latestHeadSha: pr.headRefOid,
        });
        return;
      }
      pr = await github.merge(pr.number, state.latestHeadSha ?? pr.headRefOid, {
        checkout: state.checkoutPath,
        branch: state.branch,
        readyCommand: input.mergeCommand,
      });
    }
    if (pr.mergeCommit === null)
      throw new Error("Merged PR has no merge commit");
    if (
      state.deliveryMode === "autonomous" &&
      input.confirmMerged === undefined
    )
      throw new Error(
        "Autonomous completion requires base-branch ancestry verification",
      );
    await input.confirmMerged?.(pr.mergeCommit.oid, env);
    // Persist the completion phase before cleanup: if any step below
    // fails, the next run retries only completion from "completing"
    // instead of launching another agent turn against a half-done issue.
    const completing = await input.save(state, "completing", {
      latestHeadSha: pr.headRefOid,
      mergeCommitSha: pr.mergeCommit.oid,
    });
    await completeTask({
      state: completing,
      linear: input.linear,
      save: input.save,
      writeInfo: input.writeInfo,
    });
  });
}

export async function completeTask(input: {
  state: TaskState;
  linear: LinearClient;
  save: Save;
  writeInfo: (message: string) => void;
}): Promise<void> {
  const { state } = input;
  if (
    state.deliveryMode === "autonomous" &&
    state.prUrl !== null &&
    state.mergeCommitSha === null
  )
    throw new Error("Autonomous completion requires a confirmed merge commit");
  // Only the merge path sets a PR URL; the agent no-change path completes
  // without one. Either way the terminal Linear state lands inside the
  // cleanup call, after the labels.
  if (state.prUrl === null) {
    await input.linear.completeNoChange(state.issue);
    await input.save(state, "done", { resumePhase: null });
    input.writeInfo(
      `${state.issue.identifier}: no change was needed; issue completed`,
    );
    return;
  }
  await input.linear.complete(state.issue, state.prUrl);
  await input.save(state, "done", { resumePhase: null });
  input.writeInfo(`${state.issue.identifier}: merged ${state.prUrl}`);
}

export async function collectDiagnostics(input: {
  prNumber: number;
  health: PrHealth;
  checkout: string;
  headSha: string;
  withGitHub: <T>(
    work: (
      github: GitHubClient,
      env: Readonly<Record<string, string>>,
    ) => Promise<T>,
  ) => Promise<T>;
}): Promise<{
  text: string;
  findingKeys: string[];
  reviewFindings: ReviewFindingRef[];
  blockedReasons: string[];
}> {
  return await input.withGitHub(async (github) => {
    const [text, reviews] = await Promise.all([
      github.failureDiagnostics(input.prNumber, input.health, input.checkout),
      github.reviewDiagnostics(input.prNumber, input.checkout, input.headSha),
    ]);
    return {
      text: `${text}\n\n${reviews.text}`,
      findingKeys: reviews.findings
        .filter((ref) => ref.provider === "codex")
        .map((ref) => ref.key),
      reviewFindings: reviews.findings,
      blockedReasons: reviews.blockedReasons,
    };
  });
}

export type TaskStore = {
  save: (state: TaskState) => Promise<void>;
};

export async function pauseTask(input: {
  state: TaskState;
  reason: string;
  linear: LinearClient;
  store: TaskStore;
}): Promise<void> {
  // Mutate first, save after: if the label add fails, local state still
  // describes runnable work instead of a park that never landed, so the
  // next run retries the turn rather than resuming stopped work.
  const parked = {
    ...input.state,
    phase: "needs_human",
    resumePhase: input.state.resumePhase ?? input.state.phase,
    updatedAt: currentTimestamp(),
  } as const;
  try {
    await input.linear.needsHuman(input.state.issue, input.reason);
    await input.store.save({ ...parked });
  } catch (error) {
    // The label may have landed without the save: roll it back so the
    // next run retries the turn instead of running parked work. Best
    // effort — the original error still throws so the failure is recorded.
    try {
      await input.linear.requeue(input.state.issue);
    } catch (rollbackError) {
      const detail =
        rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
      console.error(
        `${input.state.issue.identifier}: park rollback failed: ${detail}`,
      );
    }
    throw error;
  }
  console.error(`${input.state.issue.identifier}: ${input.reason}`);
}

export async function pauseAfterNoChangeFeedback(input: {
  state: TaskState;
  linear: LinearClient;
  store: StateStore;
}): Promise<void> {
  await pauseTask({
    state: input.state,
    reason:
      "The agent reported no change after owner feedback; explicit confirmation is required before merging.",
    linear: input.linear,
    store: input.store,
  });
}

export async function recordFailure(input: {
  state: TaskState;
  error: unknown;
  linear: LinearClient;
  store: StateStore;
}): Promise<void> {
  const message =
    input.error instanceof Error ? input.error.message : String(input.error);
  const failureCount = input.state.failureCount + 1;
  const limit = ["claiming", "claimed", "implementing", "publishing"].includes(
    input.state.phase,
  )
    ? 2
    : 5;
  const failed: TaskState = {
    ...input.state,
    failureCount,
    lastFailureFingerprint: Bun.hash(message).toString(16),
    updatedAt: currentTimestamp(),
  };
  if (failureCount >= limit) {
    await pauseTask({
      state: failed,
      reason: `Stopped after ${String(failureCount)} consecutive failures in ${input.state.phase}: ${message}`,
      linear: input.linear,
      store: input.store,
    });
    return;
  }
  await input.store.save(failed);
  console.error(
    `${input.state.issue.identifier}: ${message} (attempt ${String(failureCount)}/${String(limit)})`,
  );
}
