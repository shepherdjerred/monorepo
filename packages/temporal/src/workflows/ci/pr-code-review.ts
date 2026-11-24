import {
  allHandlersFinished,
  condition,
  continueAsNew,
  defineSignal,
  setHandler,
} from "@temporalio/workflow";
import type {
  ProviderId,
  WeightedSelectionOutcome,
} from "@shepherdjerred/code-review";
import type { VerifyAndCheckBlockingThreadsResult } from "#activities/ci/code-review-types.ts";
import type {
  PrCodeReviewWorkflowInput,
  ProviderAssignmentPayload,
} from "#shared/ci/code-review.ts";
import {
  codeReviewActivitiesProxy,
  runFailoverAssignmentLoop,
  type RecheckState,
} from "./pr-code-review-helpers.ts";

const WATCH_TICKS_PER_RUN = 360;
const MAX_WATCH_ITERATIONS = 12;

export const providerAssignmentSignal =
  defineSignal<[ProviderAssignmentPayload]>("providerAssignment");
export const recheckReviewSignal = defineSignal("recheckReview");

async function watchForThreadResolution(args: {
  input: PrCodeReviewWorkflowInput;
  assignedProvider: ProviderId | null;
  recheck: RecheckState;
  elapsedSeconds: () => number;
  initialVerification?: VerifyAndCheckBlockingThreadsResult | undefined;
}): Promise<void> {
  const { input, assignedProvider, recheck } = args;
  const initial =
    args.initialVerification ??
    (await codeReviewActivitiesProxy.verifyAndCheckBlockingThreads({
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      headSha: input.headSha,
      providerId: assignedProvider,
    }));
  if (!initial.active) {
    return;
  }
  if (initial.passed) {
    const resumedWatch = (input.watchIteration ?? 0) > 0;
    await codeReviewActivitiesProxy.postCodeReviewCommitStatus({
      owner: input.owner,
      repo: input.repo,
      sha: input.headSha,
      state: "success",
      description: initial.description,
      reason: resumedWatch ? "threads-resolved" : "clean",
      durationSeconds: args.elapsedSeconds(),
    });
    return;
  }

  await codeReviewActivitiesProxy.postCodeReviewCommitStatus({
    owner: input.owner,
    repo: input.repo,
    sha: input.headSha,
    state: "failure",
    description: initial.description,
    reason: initial.failureReason ?? "blocking-findings",
    durationSeconds: args.elapsedSeconds(),
    recordOutcome: (input.watchIteration ?? 0) === 0,
  });

  let lastDescription = initial.description;
  for (let tick = 0; tick < WATCH_TICKS_PER_RUN; tick += 1) {
    await condition(() => recheck.requested, "60s");
    recheck.requested = false;

    const check = await codeReviewActivitiesProxy.verifyAndCheckBlockingThreads(
      {
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
        headSha: input.headSha,
        providerId: assignedProvider,
      },
    );
    if (!check.active) {
      return;
    }
    if (check.passed) {
      await codeReviewActivitiesProxy.postCodeReviewCommitStatus({
        owner: input.owner,
        repo: input.repo,
        sha: input.headSha,
        state: "success",
        description: "All blocking P0/P1 findings resolved",
        reason: "threads-resolved",
        durationSeconds: args.elapsedSeconds(),
      });
      return;
    }
    if (check.description !== lastDescription) {
      lastDescription = check.description;
      await codeReviewActivitiesProxy.postCodeReviewCommitStatus({
        owner: input.owner,
        repo: input.repo,
        sha: input.headSha,
        state: "failure",
        description: check.description,
        recordOutcome: false,
      });
    }
  }

  const nextIteration = (input.watchIteration ?? 0) + 1;
  if (nextIteration <= MAX_WATCH_ITERATIONS) {
    await condition(() => allHandlersFinished());
    await continueAsNew<typeof prCodeReviewWorkflow>({
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      headSha: input.headSha,
      baseRef: input.baseRef,
      assignedProviderId: assignedProvider,
      watchIteration: nextIteration,
    });
  }
}

/**
 * Per-PR weighted round-robin code-review workflow. Assigns one review provider
 * via `codeReviewCoordinatorWorkflow`, fails over on quota/timeout, passes
 * advisories if all providers are quota-exhausted or timed out, and watches
 * blocking P0/P1 threads across a bounded window (`MAX_WATCH_ITERATIONS`, ~78h).
 */
export async function prCodeReviewWorkflow(
  input: PrCodeReviewWorkflowInput,
): Promise<void> {
  if (input.baseRef !== "main") {
    return;
  }

  const startedAtMs = Date.now();
  const elapsedSeconds = () => Math.max(0, (Date.now() - startedAtMs) / 1000);
  const assignments = new Map<string, WeightedSelectionOutcome>();
  const recheck: RecheckState = { requested: false };

  setHandler(providerAssignmentSignal, (payload) => {
    assignments.set(payload.requestId, payload.selection);
  });
  setHandler(recheckReviewSignal, () => {
    recheck.requested = true;
  });

  if (input.assignedProviderId !== undefined) {
    await watchForThreadResolution({
      input,
      assignedProvider: input.assignedProviderId,
      recheck,
      elapsedSeconds,
    });
    return;
  }

  const runtimeConfig =
    await codeReviewActivitiesProxy.loadCodeReviewRuntimeConfig();
  if (!runtimeConfig.enabled) {
    return;
  }

  const context = await codeReviewActivitiesProxy.inspectPrReviewContext({
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    expectedHeadSha: input.headSha,
  });
  if (!context.active) {
    return;
  }

  if (context.priorRoundCompleted) {
    if (context.p0VetoCount === 0) {
      await codeReviewActivitiesProxy.postCodeReviewCommitStatus({
        owner: input.owner,
        repo: input.repo,
        sha: input.headSha,
        state: "success",
        description: "Prior round reviewed; no unresolved P0 findings",
        reason: "prior-round",
        durationSeconds: elapsedSeconds(),
      });
      return;
    }
    await watchForThreadResolution({
      input,
      assignedProvider: null,
      recheck,
      elapsedSeconds,
    });
    return;
  }

  if (context.completedAtHead !== null) {
    await watchForThreadResolution({
      input,
      assignedProvider: context.completedAtHead.providerId,
      recheck,
      elapsedSeconds,
    });
    return;
  }

  const failover = await runFailoverAssignmentLoop({
    input,
    author: context.author,
    headPushedAt: context.headPushedAt,
    settings: runtimeConfig.settings,
    assignments,
    recheck,
    elapsedSeconds,
  });
  if (failover.kind === "done") {
    return;
  }

  await watchForThreadResolution({
    input,
    assignedProvider: failover.assignedProvider,
    recheck,
    elapsedSeconds,
    initialVerification: failover.initialVerification,
  });
}
