import {
  condition,
  continueAsNew,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import {
  ScoutChallengeRunRecomputeInputSchema,
  ScoutDuelSeriesChangeSchema,
  ScoutDuelSeriesInputSchema,
  ScoutHallBaselineInputSchema,
  type ScoutChallengeRunRecomputeInput,
  type ScoutDuelSeriesInput,
  type ScoutHallBaselineInput,
  type ScoutWorkflowStatus,
} from "#src/contracts.ts";
import { duelSeriesChangedSignal } from "#src/signals.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import { backgroundActivities, lakeActivities } from "./activity-options.ts";

export async function scoutHallBaselineWorkflow(
  rawInput: ScoutHallBaselineInput,
): Promise<ScoutWorkflowStatus> {
  const input = ScoutHallBaselineInputSchema.parse(rawInput);
  setWorkflowPhase("**Phase:** building Hall of Fame baselines");
  await lakeActivities(input.stage).runHallBaseline(input);
  setWorkflowPhase("**Phase:** Hall of Fame baseline complete");
  return "completed";
}

export async function scoutChallengeRunRecomputeWorkflow(
  rawInput: ScoutChallengeRunRecomputeInput,
): Promise<ScoutWorkflowStatus> {
  let input = ScoutChallengeRunRecomputeInputSchema.parse(rawInput);
  const activities = lakeActivities(input.stage);
  for (;;) {
    setWorkflowPhase(
      `**Phase:** evaluating challenge evidence page ${(input.pagesProcessed + 1).toString()}`,
    );
    const page = await activities.recomputeChallengeRunPage(input);
    if (page.complete) {
      setWorkflowPhase("**Phase:** challenge recomputation complete");
      return "completed";
    }
    if (page.nextCursor === undefined) {
      throw new Error("An incomplete challenge page must return a cursor");
    }
    input = {
      ...input,
      cursor: page.nextCursor,
      pagesProcessed: input.pagesProcessed + 1,
    };
    if (input.pagesProcessed >= 100 || workflowInfo().continueAsNewSuggested) {
      await continueAsNew<typeof scoutChallengeRunRecomputeWorkflow>({
        ...input,
        pagesProcessed: 0,
      });
    }
  }
}

export async function scoutDuelSeriesWorkflow(
  rawInput: ScoutDuelSeriesInput,
): Promise<ScoutWorkflowStatus> {
  const input = ScoutDuelSeriesInputSchema.parse(rawInput);
  const activities = backgroundActivities(input.stage);
  const seenRequests = new Set<string>();
  let changed = false;
  setHandler(duelSeriesChangedSignal, (rawChange) => {
    const change = ScoutDuelSeriesChangeSchema.parse(rawChange);
    if (seenRequests.has(change.requestId)) return;
    seenRequests.add(change.requestId);
    changed = true;
  });
  const hasChanged = () => changed;

  for (;;) {
    // Clear before the Activity is scheduled. A Signal received while the
    // Activity is running then remains visible and forces an immediate second
    // refresh instead of being overwritten after the await.
    changed = false;
    setWorkflowPhase("**Phase:** coordinating duel-series readiness");
    const refreshed = await activities.refreshDuelSeries(input);
    if (refreshed.terminal) return "completed";
    const remainingMs = new Date(refreshed.deadlineAt).getTime() - Date.now();
    if (remainingMs <= 0) {
      await activities.markDuelSeriesOverdue(input);
      return "completed";
    }
    if (hasChanged()) continue;
    const receivedChange = await condition(hasChanged, remainingMs);
    if (!receivedChange) {
      setWorkflowPhase("**Phase:** marking overdue duel series");
      await activities.markDuelSeriesOverdue(input);
      return "completed";
    }
  }
}
