import { ActivityFailure, ApplicationFailure } from "@temporalio/workflow";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutStage } from "#src/contracts.ts";
import {
  SCOUT_SILENT_BACKFILL_V2_CONCURRENCY,
  scoutSilentPostmatchBackfillV2InputCodec,
  scoutSilentPostmatchBackfillV2ResultCodec,
  type ScoutSilentBackfillMatchOutcomeV2,
  type ScoutSilentPostmatchBackfillV2InputEnvelope,
  type ScoutSilentPostmatchBackfillV2ResultEnvelope,
} from "#src/silent-postmatch-backfill-v2.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import { silentPostmatchBackfillV2Activities } from "./activity-options.ts";

type SilentBackfillActivities = ReturnType<
  typeof silentPostmatchBackfillV2Activities
>;

/**
 * One match, as the backfill records it.
 *
 * An Activity that exhausted its retries is recorded against its match rather
 * than failing the run on the spot: every other match in the list is
 * independent of it, and the operator is better served by one run that did
 * everything it could and names what it could not. Anything that is NOT an
 * Activity failure — cancellation, a broken Workflow contract — propagates.
 */
async function backfillOne(
  activities: SilentBackfillActivities,
  stage: ScoutStage,
  riotMatchId: RiotMatchId,
): Promise<ScoutSilentBackfillMatchOutcomeV2> {
  try {
    const result = await activities.backfillSilentPostmatchArtifactV2({
      stage,
      riotMatchId,
    });
    return result.outcome === "skipped"
      ? { riotMatchId, outcome: "skipped", reason: result.reason }
      : { riotMatchId, outcome: result.outcome };
  } catch (error) {
    if (!(error instanceof ActivityFailure)) throw error;
    return {
      riotMatchId,
      outcome: "failed",
      message: error.cause?.message ?? error.message,
    };
  }
}

/**
 * Render and attest the post-match report of each listed match, announcing
 * nothing. Started once, by hand, by an operator; there is no Schedule.
 *
 * The only Activity this can schedule is `backfillSilentPostmatchArtifactV2`
 * (see `silentPostmatchBackfillV2Activities`), and it starts no child: no
 * notification Workflow, no match core. What the Activity may and may not do
 * is `silent-postmatch-backfill-v2.ts`'s contract and the backend's
 * implementation of it.
 *
 * Idempotent over its whole input. The Activity skips a match whose render
 * receipt already stands, and a render that races another shares its fence
 * and reports `reused`, so a rerun of the same list — after a failure, or by
 * mistake — renders nothing twice and writes no second receipt.
 *
 * Matches run at a small fixed concurrency. Lanes take the next match from
 * one queue, which is deterministic: Workflow code is single-threaded and each
 * lane resumes only when its recorded Activity completion is delivered, so
 * replay hands every lane the same matches in the same order.
 */
export async function scoutSilentPostmatchBackfillV2Workflow(
  rawInput: ScoutSilentPostmatchBackfillV2InputEnvelope,
): Promise<ScoutSilentPostmatchBackfillV2ResultEnvelope> {
  const input = scoutSilentPostmatchBackfillV2InputCodec.parse(rawInput);
  const activities = silentPostmatchBackfillV2Activities(input.stage);
  const total = input.riotMatchIds.length;
  const queue = [...input.riotMatchIds.entries()];
  const outcomes = new Map<number, ScoutSilentBackfillMatchOutcomeV2>();

  const lane = async (): Promise<void> => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const [index, riotMatchId] = next;
      setWorkflowPhase(
        `**Phase:** silently backfilling \`${riotMatchId}\` (${String(outcomes.size + 1)} of ${String(total)})`,
      );
      outcomes.set(
        index,
        await backfillOne(activities, input.stage, riotMatchId),
      );
    }
  };
  await Promise.all(
    Array.from({ length: SCOUT_SILENT_BACKFILL_V2_CONCURRENCY }, lane),
  );

  const ordered = [...outcomes.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([, outcome]) => outcome);
  const count = (kind: ScoutSilentBackfillMatchOutcomeV2["outcome"]) =>
    ordered.filter((outcome) => outcome.outcome === kind).length;
  const summary = {
    status: "completed" as const,
    requested: total,
    rendered: count("rendered"),
    reused: count("reused"),
    skipped: count("skipped"),
    failed: count("failed"),
    outcomes: ordered,
  };
  setWorkflowPhase(
    `**Phase:** done — ${String(summary.rendered)} rendered, ${String(summary.reused)} reused, ${String(summary.skipped)} skipped, ${String(summary.failed)} failed`,
  );

  if (summary.failed > 0) {
    // Fails the run, visibly, with the whole tally attached: the operator
    // reruns the same list, and every match that already succeeded is skipped
    // on its receipt.
    const failedIds = ordered
      .filter((outcome) => outcome.outcome === "failed")
      .map((outcome) => outcome.riotMatchId);
    throw ApplicationFailure.nonRetryable(
      `Silent post-match backfill could not render ${String(summary.failed)} of ${String(total)} matches: ${failedIds.join(", ")}`,
      "SilentBackfillIncomplete",
      scoutSilentPostmatchBackfillV2ResultCodec.serialize(summary),
    );
  }
  return scoutSilentPostmatchBackfillV2ResultCodec.serialize(summary);
}
