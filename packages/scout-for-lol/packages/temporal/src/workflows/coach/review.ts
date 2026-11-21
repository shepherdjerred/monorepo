import { sleep } from "@temporalio/workflow";
import {
  ScoutCoachReviewInputSchema,
  type ScoutCoachReviewInput,
  type ScoutCoachReviewResult,
} from "#src/contracts.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import { backgroundActivities } from "#src/workflows/activity-options.ts";

/** How often the Workflow asks whether the Explore turn has finished. */
export const COACH_REVIEW_POLL_INTERVAL = "15 seconds";
/**
 * Polls before the Workflow stops waiting: 15 seconds apiece is 40 minutes,
 * longer than any Explore turn's own 30-minute activity ceiling, so reaching
 * it means the turn is wedged, not slow.
 */
export const COACH_REVIEW_MAX_POLLS = 160;

/**
 * The post-game review of one game the owner recorded.
 *
 * Started, idempotently, by whichever of the two inputs arrives second: the
 * live-game recording upload or the resolved match evidence. The first
 * Activity re-checks both and the owner's `scout_desktop_coach` flag, so a
 * stale trigger never produces a review for a game the owner did not record;
 * it then starts one durable Explore turn (the `game-review` skill, the
 * Explore profile, the `app_postgame` initiation, which never carries `live`).
 * The turn is its own durable run under the existing Explore quota and spend
 * ledger; this Workflow only waits for it and records where it ended.
 *
 * A quota or spend refusal is a recorded `declined`, not a retry: retrying
 * would be a second provider request after the limit said no.
 */
export async function scoutCoachReviewWorkflow(
  rawInput: ScoutCoachReviewInput,
): Promise<ScoutCoachReviewResult> {
  const input = ScoutCoachReviewInputSchema.parse(rawInput);
  const activities = backgroundActivities(input.stage);

  setWorkflowPhase("**Phase:** starting the post-game review");
  const started = await activities.startCoachReview(input);
  if (started.outcome === "skipped") {
    return { status: "skipped", reason: started.reason };
  }
  if (started.outcome === "declined") return { status: "declined" };
  if (started.outcome === "settled") return { status: started.status };

  setWorkflowPhase("**Phase:** waiting for the post-game review");
  for (let poll = 1; poll <= COACH_REVIEW_MAX_POLLS; poll += 1) {
    const status = await activities.settleCoachReview({
      ...input,
      runId: started.runId,
      giveUp: poll === COACH_REVIEW_MAX_POLLS,
    });
    if (status !== "pending") return { status };
    await sleep(COACH_REVIEW_POLL_INTERVAL);
  }
  return { status: "failed" };
}
