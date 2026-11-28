import type { ScoutLiveRosterFormResult } from "@scout-for-lol/temporal/activity-contracts";
import type { ScoutGameRef } from "@scout-for-lol/temporal/pipeline-contracts";
import { scoutPrematchGameMatchId } from "@scout-for-lol/temporal/identifiers";
import configuration from "#src/configuration.ts";
import { riotBudgetMode } from "#src/config/dynamic.ts";
import { createLiveFormRiotApi } from "#src/live-roster/live-roster-form-riot.ts";
import { recordLiveRosterRecentForm } from "#src/live-roster/live-roster-form.ts";

/**
 * How long one attempt may spend on Riot, waiting on the budget ledger
 * included. Past it the attempt keeps what it has, gives up on the rest and
 * fails retryably, so the Activity's backoff spaces the next try out instead
 * of this one holding a worker while the key is busy.
 */
export const LIVE_FORM_PASS_BUDGET_MS = 4 * 60 * 1000;

/** The Activity: one live game's strangers, read at `backfill` priority. */
export async function recordLiveRosterRecentFormActivity(
  input: ScoutGameRef,
): Promise<ScoutLiveRosterFormResult> {
  const riot = createLiveFormRiotApi({
    apiKey: configuration.riotApiToken,
    budgetMode: riotBudgetMode,
    signal: AbortSignal.timeout(LIVE_FORM_PASS_BUDGET_MS),
  });
  return await recordLiveRosterRecentForm(
    scoutPrematchGameMatchId(input.gameRef),
    { riot, now: () => new Date() },
  );
}
