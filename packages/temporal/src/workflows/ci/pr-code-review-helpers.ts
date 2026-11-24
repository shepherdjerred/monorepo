import {
  condition,
  proxyActivities,
  uuid4,
  workflowInfo,
} from "@temporalio/workflow";
import {
  PROVIDERS,
  type ProviderId,
  type PullRequestAuthor,
  type WeightedSelectionOutcome,
} from "@shepherdjerred/code-review";
import type { CodeReviewActivities } from "#activities/ci/code-review.ts";
import type {
  TriggerAndObserveProviderResult,
  VerifyAndCheckBlockingThreadsResult,
} from "#activities/ci/code-review-types.ts";
import type {
  CodeReviewSettings,
  PrCodeReviewWorkflowInput,
} from "#shared/ci/code-review.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

export const codeReviewActivitiesProxy = proxyActivities<CodeReviewActivities>({
  taskQueue: TASK_QUEUES.CODE_REVIEW,
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 4,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
  },
});

export type RecheckState = {
  requested: boolean;
};

type ProviderPollOutcome =
  | { kind: "inactive" }
  | { kind: "completed"; providerId: ProviderId }
  | { kind: "skipped" }
  | { kind: "quota-or-error" };

export type FailoverResult =
  | { kind: "done" }
  | {
      kind: "watch";
      assignedProvider: ProviderId | null;
      initialVerification?: VerifyAndCheckBlockingThreadsResult;
    };

async function claimNextProvider(args: {
  prNumber: number;
  headSha: string;
  author: PullRequestAuthor;
  settings: CodeReviewSettings;
  excludeProviders: ProviderId[];
  assignments: Map<string, WeightedSelectionOutcome>;
}): Promise<WeightedSelectionOutcome> {
  const info = workflowInfo();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requestId = uuid4();
    await codeReviewActivitiesProxy.dispatchCoordinatorClaim({
      requestId,
      replyWorkflowId: info.workflowId,
      replyRunId: info.runId,
      prNumber: args.prNumber,
      headSha: args.headSha,
      author: args.author,
      weights: args.settings.weights,
      excludeProviders: args.excludeProviders,
      nowMs: Date.now(),
    });

    const arrived = await condition(
      () => args.assignments.has(requestId),
      "20s",
    );
    const selection = args.assignments.get(requestId);
    if (arrived && selection !== undefined) {
      args.assignments.delete(requestId);
      return selection;
    }
  }
  throw new Error(
    `Timed out awaiting coordinator assignment for PR #${String(args.prNumber)}`,
  );
}

async function handleObservedError(args: {
  providerId: ProviderId;
  blockedReason: string | null;
  settings: CodeReviewSettings;
}): Promise<ProviderPollOutcome> {
  if (args.blockedReason === "usage-limited") {
    await codeReviewActivitiesProxy.reportCoordinatorOutcome({
      providerId: args.providerId,
      outcome: "usage-limited",
      cooldownMs: args.settings.quotaCooldownSeconds * 1000,
      nowMs: Date.now(),
    });
    return { kind: "quota-or-error" };
  }
  if (args.blockedReason === "missing-seat") {
    await codeReviewActivitiesProxy.reportCoordinatorOutcome({
      providerId: args.providerId,
      outcome: "skipped",
      cooldownMs: 0,
      nowMs: Date.now(),
    });
    return { kind: "skipped" };
  }
  await codeReviewActivitiesProxy.reportCoordinatorOutcome({
    providerId: args.providerId,
    outcome: "timed-out",
    cooldownMs: args.settings.timeoutCooldownSeconds * 1000,
    nowMs: Date.now(),
  });
  return { kind: "quota-or-error" };
}

async function evaluateObservedProviderState(args: {
  observed: TriggerAndObserveProviderResult;
  providerId: ProviderId;
  settings: CodeReviewSettings;
}): Promise<ProviderPollOutcome | null> {
  const { observed, providerId, settings } = args;
  if (!observed.active) {
    return { kind: "inactive" };
  }
  if (observed.reviewState === "reviewed") {
    const skipped = observed.skipReason !== null;
    await codeReviewActivitiesProxy.reportCoordinatorOutcome({
      providerId,
      outcome: skipped ? "skipped" : "completed",
      cooldownMs: 0,
      nowMs: Date.now(),
    });
    return skipped ? { kind: "skipped" } : { kind: "completed", providerId };
  }
  if (observed.reviewState === "errored") {
    return await handleObservedError({
      providerId,
      blockedReason: observed.blockedReason,
      settings,
    });
  }
  return null;
}

async function pollAssignedProvider(args: {
  input: PrCodeReviewWorkflowInput;
  headPushedAt: string | null;
  providerId: ProviderId;
  settings: CodeReviewSettings;
  recheck: RecheckState;
}): Promise<ProviderPollOutcome> {
  const { input, providerId, settings, recheck } = args;
  const displayName = PROVIDERS[providerId].displayName;
  await codeReviewActivitiesProxy.postCodeReviewCommitStatus({
    owner: input.owner,
    repo: input.repo,
    sha: input.headSha,
    state: "pending",
    description: `Waiting for ${displayName} code review`,
  });

  const providerStartedAt = Date.now();
  const providerTimeoutMs = settings.providerTimeoutSeconds * 1000;
  const retryAfterMs = settings.requestRetrySeconds * 1000;
  let lastRequestedAttempt = 0;

  while (Date.now() - providerStartedAt < providerTimeoutMs) {
    const attempt = Date.now() - providerStartedAt >= retryAfterMs ? 2 : 1;
    const shouldRequest = attempt > lastRequestedAttempt;
    const observed = await codeReviewActivitiesProxy.triggerAndObserveProvider({
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      headSha: input.headSha,
      headPushedAt: args.headPushedAt,
      providerId,
      attempt,
      shouldRequest,
    });
    if (shouldRequest) {
      lastRequestedAttempt = attempt;
    }

    const settled = await evaluateObservedProviderState({
      observed,
      providerId,
      settings,
    });
    if (settled !== null) {
      return settled;
    }

    const remainingMs = providerTimeoutMs - (Date.now() - providerStartedAt);
    if (remainingMs <= 0) {
      break;
    }
    await condition(() => recheck.requested, Math.min(30_000, remainingMs));
    recheck.requested = false;
  }

  await codeReviewActivitiesProxy.reportCoordinatorOutcome({
    providerId,
    outcome: "timed-out",
    cooldownMs: settings.timeoutCooldownSeconds * 1000,
    nowMs: Date.now(),
  });
  return { kind: "quota-or-error" };
}

function isSkippedExhaustion(
  reason: "all-blocked" | "all-skipped" | "no-configured-providers",
  sawSkip: boolean,
  sawQuotaOrTimeout: boolean,
): boolean {
  return (
    !sawQuotaOrTimeout &&
    (reason === "all-skipped" ||
      reason === "no-configured-providers" ||
      sawSkip)
  );
}

async function handleExhaustedSelection(args: {
  input: PrCodeReviewWorkflowInput;
  reason: "all-blocked" | "all-skipped" | "no-configured-providers";
  sawSkip: boolean;
  sawQuotaOrTimeout: boolean;
  elapsedSeconds: () => number;
}): Promise<FailoverResult> {
  const p0Check = await codeReviewActivitiesProxy.verifyAndCheckBlockingThreads(
    {
      owner: args.input.owner,
      repo: args.input.repo,
      prNumber: args.input.prNumber,
      headSha: args.input.headSha,
      providerId: null,
    },
  );
  if (!p0Check.active) {
    return { kind: "done" };
  }
  if (!p0Check.passed) {
    return {
      kind: "watch",
      assignedProvider: null,
      initialVerification: p0Check,
    };
  }

  const skippedAll = isSkippedExhaustion(
    args.reason,
    args.sawSkip,
    args.sawQuotaOrTimeout,
  );
  await codeReviewActivitiesProxy.postCodeReviewCommitStatus({
    owner: args.input.owner,
    repo: args.input.repo,
    sha: args.input.headSha,
    state: "success",
    description: skippedAll
      ? "Review skipped: no eligible reviewer for PR"
      : "All review providers quota-limited; passing advisories",
    reason: skippedAll ? "all-skipped" : "quota-exempt",
    durationSeconds: args.elapsedSeconds(),
  });
  return { kind: "done" };
}

function terminalFailoverOutcome(
  outcome: ProviderPollOutcome,
): FailoverResult | null {
  if (outcome.kind === "inactive") {
    return { kind: "done" };
  }
  return outcome.kind === "completed"
    ? { kind: "watch", assignedProvider: outcome.providerId }
    : null;
}

export async function runFailoverAssignmentLoop(args: {
  input: PrCodeReviewWorkflowInput;
  author: PullRequestAuthor;
  headPushedAt: string | null;
  settings: CodeReviewSettings;
  assignments: Map<string, WeightedSelectionOutcome>;
  recheck: RecheckState;
  elapsedSeconds: () => number;
}): Promise<FailoverResult> {
  const triedProviders: ProviderId[] = [];
  let sawQuotaOrTimeout = false;
  let sawSkip = false;

  for (;;) {
    const selection = await claimNextProvider({
      prNumber: args.input.prNumber,
      headSha: args.input.headSha,
      author: args.author,
      settings: args.settings,
      excludeProviders: triedProviders,
      assignments: args.assignments,
    });

    if (selection.kind === "exhausted") {
      return await handleExhaustedSelection({
        input: args.input,
        reason: selection.reason,
        sawSkip,
        sawQuotaOrTimeout,
        elapsedSeconds: args.elapsedSeconds,
      });
    }

    triedProviders.push(selection.providerId);
    const outcome = await pollAssignedProvider({
      input: args.input,
      headPushedAt: args.headPushedAt,
      providerId: selection.providerId,
      settings: args.settings,
      recheck: args.recheck,
    });

    const terminal = terminalFailoverOutcome(outcome);
    if (terminal !== null) {
      return terminal;
    }
    if (outcome.kind === "skipped") {
      sawSkip = true;
    } else {
      sawQuotaOrTimeout = true;
    }
  }
}
