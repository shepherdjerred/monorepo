import {
  RANK_REFRESH_MAX_BATCHES,
  ScoutRankRefreshInputSchema,
  type ScoutRankRefreshInput,
  type ScoutRankRefreshResult,
} from "#src/rank-refresh-contracts.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import { backgroundActivities } from "#src/workflows/activity-options.ts";

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
 */
export async function scoutRankRefreshWorkflow(
  rawInput: ScoutRankRefreshInput,
): Promise<ScoutRankRefreshResult> {
  const input = ScoutRankRefreshInputSchema.parse(rawInput);
  setWorkflowPhase("**Phase:** refreshing stale player ranks");
  const activities = backgroundActivities(input.stage);
  const total = { enabled: true, batches: 0, refreshed: 0, unranked: 0 };
  let more = true;
  while (more && total.batches < RANK_REFRESH_MAX_BATCHES) {
    const batch = await activities.refreshStaleRanks(input);
    total.enabled = batch.enabled;
    total.batches += 1;
    total.refreshed += batch.refreshed;
    total.unranked += batch.unranked;
    more = batch.more;
  }
  return { ...total, drained: !more };
}
