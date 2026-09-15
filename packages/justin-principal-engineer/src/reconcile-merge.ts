import { deliveryIsHealthy } from "#src/domain/delivery-health.ts";
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

export async function mergeTask(input: {
  state: TaskState;
  withGitHub: (
    work: (
      github: GitHubClient,
      env: Readonly<Record<string, string>>,
    ) => Promise<void>,
  ) => Promise<void>;
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
    await input.linear.complete(state.issue.identifier, pr.url);
    await input.save(state, "done", {
      latestHeadSha: pr.headRefOid,
      resumePhase: null,
    });
    input.writeInfo(`${state.issue.identifier}: merged ${pr.url}`);
  });
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

export async function pauseTask(input: {
  state: TaskState;
  reason: string;
  linear: LinearClient;
  store: StateStore;
}): Promise<void> {
  await input.store.save({
    ...input.state,
    phase: "needs_human",
    resumePhase: input.state.resumePhase ?? input.state.phase,
    updatedAt: currentTimestamp(),
  });
  await input.linear.needsHuman(input.state.issue.identifier, input.reason);
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
