import {
  allHandlersFinished,
  condition,
  continueAsNew,
  defineSignal,
  getExternalWorkflowHandle,
  setHandler,
  upsertMemo,
} from "@temporalio/workflow";
import {
  applyProviderCooldown,
  EMPTY_SMOOTH_WEIGHTED_STATE,
  selectNextWeightedProvider,
} from "@shepherdjerred/code-review";
import type {
  ClaimProviderSignalPayload,
  CodeReviewCoordinatorState,
  ProviderAssignmentPayload,
  ReportProviderOutcomePayload,
} from "#shared/ci/code-review.ts";

const MAX_EVENTS_BEFORE_CONTINUE_AS_NEW = 500;

export const claimProviderSignal =
  defineSignal<[ClaimProviderSignalPayload]>("claimProvider");
export const reportProviderOutcomeSignal = defineSignal<
  [ReportProviderOutcomePayload]
>("reportProviderOutcome");

function drainOutcomeQueue(
  current: CodeReviewCoordinatorState,
  outcomeQueue: ReportProviderOutcomePayload[],
): CodeReviewCoordinatorState {
  let next = current;
  while (outcomeQueue.length > 0) {
    const outcome = outcomeQueue.shift();
    if (outcome === undefined) {
      break;
    }
    const weighted =
      outcome.cooldownMs > 0
        ? applyProviderCooldown(
            next.weighted,
            outcome.providerId,
            outcome.cooldownMs,
            outcome.nowMs,
          )
        : next.weighted;
    next = {
      weighted,
      processedCount: next.processedCount + 1,
    };
    upsertMemo({ codeReviewCoordinator: next });
  }
  return next;
}

async function processClaim(
  current: CodeReviewCoordinatorState,
  claim: ClaimProviderSignalPayload,
): Promise<CodeReviewCoordinatorState> {
  const { selection, nextState } = selectNextWeightedProvider({
    state: current.weighted,
    weights: claim.weights,
    author: claim.author,
    excludeProviders: claim.excludeProviders,
    nowMs: claim.nowMs,
  });
  const updated: CodeReviewCoordinatorState = {
    weighted: nextState,
    processedCount: current.processedCount + 1,
  };
  upsertMemo({ codeReviewCoordinator: updated });

  const reply: ProviderAssignmentPayload = {
    requestId: claim.requestId,
    selection,
  };
  try {
    const caller = getExternalWorkflowHandle(
      claim.replyWorkflowId,
      claim.replyRunId,
    );
    await caller.signal("providerAssignment", reply);
  } catch {
    // Caller PR workflow may have already terminated or been superseded.
  }

  return updated;
}

/**
 * Singleton Smooth Weighted Round-Robin coordinator across all PR code-review
 * workflows. Serializes weight progression and temporary provider cooldowns.
 */
export async function codeReviewCoordinatorWorkflow(
  initialState?: CodeReviewCoordinatorState,
): Promise<never> {
  let state: CodeReviewCoordinatorState =
    initialState === undefined
      ? {
          weighted: EMPTY_SMOOTH_WEIGHTED_STATE,
          processedCount: 0,
        }
      : {
          weighted: initialState.weighted,
          processedCount: initialState.processedCount,
        };
  const claimQueue: ClaimProviderSignalPayload[] = [];
  const outcomeQueue: ReportProviderOutcomePayload[] = [];

  setHandler(claimProviderSignal, (payload) => {
    claimQueue.push(payload);
  });
  setHandler(reportProviderOutcomeSignal, (payload) => {
    outcomeQueue.push(payload);
  });

  upsertMemo({ codeReviewCoordinator: state });

  for (;;) {
    if (
      state.processedCount >= MAX_EVENTS_BEFORE_CONTINUE_AS_NEW &&
      claimQueue.length === 0 &&
      outcomeQueue.length === 0 &&
      allHandlersFinished()
    ) {
      return await continueAsNew<typeof codeReviewCoordinatorWorkflow>({
        weighted: state.weighted,
        processedCount: 0,
      });
    }

    await condition(() => claimQueue.length > 0 || outcomeQueue.length > 0);

    state = drainOutcomeQueue(state, outcomeQueue);

    while (claimQueue.length > 0) {
      const claim = claimQueue.shift();
      if (claim === undefined) {
        break;
      }
      state = drainOutcomeQueue(state, outcomeQueue);
      state = await processClaim(state, claim);
    }
  }
}
