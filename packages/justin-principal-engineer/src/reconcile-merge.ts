import {
  deliveryIsHealthy,
  deliveryIsUnhealthy,
} from "#src/domain/delivery-health.ts";
import type { PrHealth, TaskState } from "#src/domain/schemas.ts";
import type { GitHubClient, PullRequest } from "#src/integrations/github.ts";
import type { LinearClient } from "#src/integrations/linear.ts";
import type { StateStore } from "#src/runtime/state-store.ts";
import { currentTimestamp } from "#src/runtime/time.ts";

type Save = (
  state: TaskState,
  phase: TaskState["phase"],
  patch?: Partial<TaskState>,
) => Promise<TaskState>;

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
  });
  await input.save(input.state, "implementing", {
    pendingHealth: input.health,
    pendingDiagnostics: diagnostics.text,
    pendingCodexFindingKeys: diagnostics.findingKeys,
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
}): Promise<void> {
  const { state } = input;
  if (state.prNumber === null || state.prUrl === null) {
    throw new Error("Merging task has no PR");
  }
  const prNumber = state.prNumber;
  await input.withGitHub(async (github) => {
    const pr: PullRequest = await github.pullRequest(prNumber);
    if (pr.mergedAt === null) {
      const health = await github.health(pr.number, state.checkoutPath);
      const approved = await github.hasExactHeadApproval(
        pr.number,
        pr.headRefOid,
      );
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
      await github.merge(pr.number, pr.headRefOid);
    }
    // Persist the completion phase before cleanup: if any step below
    // fails, the next run retries only completion from "completing"
    // instead of launching another agent turn against a half-done issue.
    const completing = await input.save(state, "completing", {
      latestHeadSha: pr.headRefOid,
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
  withGitHub: <T>(
    work: (
      github: GitHubClient,
      env: Readonly<Record<string, string>>,
    ) => Promise<T>,
  ) => Promise<T>;
}): Promise<{ text: string; findingKeys: string[] }> {
  return await input.withGitHub(async (github) => {
    const [text, findingKeys] = await Promise.all([
      github.failureDiagnostics(input.prNumber, input.health, input.checkout),
      github.openCodexFindingKeys(input.prNumber, input.checkout),
    ]);
    return { text, findingKeys };
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
