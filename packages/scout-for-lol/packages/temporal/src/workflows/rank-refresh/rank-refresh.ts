import { ApplicationFailure } from "@temporalio/workflow";
import {
  RANK_REFRESH_MAX_BATCHES,
  RANK_REFRESH_MAX_PERMANENT_FAILURES,
  RANK_REFRESH_PUUID_PREFIX_LENGTH,
  ScoutRankRefreshInputSchema,
  type ScoutRankRefreshInput,
  type ScoutRankRefreshPermanentFailure,
  type ScoutRankRefreshResult,
} from "#src/rank-refresh-contracts.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import { backgroundActivities } from "#src/workflows/activity-options.ts";

const NAMED_FAILURES = 20;

/**
 * The one error a run ends with when Riot permanently rejected some players:
 * how many, and the first characters of their PUUIDs, never the full id.
 */
function permanentFailuresError(
  failures: readonly ScoutRankRefreshPermanentFailure[],
  total: { refreshed: number; unranked: number },
): ApplicationFailure {
  const named = failures
    .slice(0, NAMED_FAILURES)
    .map(
      (failure) =>
        `${failure.puuid.slice(0, RANK_REFRESH_PUUID_PREFIX_LENGTH)} (HTTP ${failure.status.toString()})`,
    );
  const more = failures.length - named.length;
  return ApplicationFailure.nonRetryable(
    `Riot permanently rejected ${failures.length.toString()} player(s) in the rank refresh: ${named.join(", ")}${more > 0 ? `, and ${more.toString()} more` : ""}. The other players were refreshed first (${total.refreshed.toString()} ranked, ${total.unranked.toString()} unranked).`,
    "RankRefreshPermanentFailures",
    { count: failures.length },
  );
}

/**
 * Refreshes the current rank of every tracked player with no rank evidence in
 * the last seven days, started once a day by a declarative Schedule with
 * overlap SKIP.
 *
 * The Activity owns who is due, the kill switch and the Riot calls, and each
 * call handles one bounded batch. A player refreshed by an earlier batch (or by
 * an earlier attempt of the same batch) is no longer due, so the Workflow only
 * repeats the Activity while batches come back full. It runs on the background
 * queue with the Riot `backfill` priority: below live and interactive traffic,
 * above the crawl.
 *
 * A player Riot permanently rejects (a 4xx other than 404, 408 and 429) is
 * never written, so it would stay due; the Workflow carries those players
 * between batches so the Activity skips them, lets every other player be
 * refreshed, and only then fails the run with one error naming them.
 */
export async function scoutRankRefreshWorkflow(
  rawInput: ScoutRankRefreshInput,
): Promise<ScoutRankRefreshResult> {
  const input = ScoutRankRefreshInputSchema.parse(rawInput);
  setWorkflowPhase("**Phase:** refreshing stale player ranks");
  const activities = backgroundActivities(input.stage);
  const total = { enabled: true, batches: 0, refreshed: 0, unranked: 0 };
  const failures: ScoutRankRefreshPermanentFailure[] = [];
  let more = true;
  while (
    more &&
    total.batches < RANK_REFRESH_MAX_BATCHES &&
    failures.length < RANK_REFRESH_MAX_PERMANENT_FAILURES
  ) {
    const batch = await activities.refreshStaleRanks({
      ...input,
      excluded: failures.map((failure) => failure.puuid),
    });
    total.enabled = batch.enabled;
    total.batches += 1;
    total.refreshed += batch.refreshed;
    total.unranked += batch.unranked;
    failures.push(...batch.failed);
    more = batch.more;
  }
  if (failures.length > 0) throw permanentFailuresError(failures, total);
  return { ...total, drained: !more };
}
