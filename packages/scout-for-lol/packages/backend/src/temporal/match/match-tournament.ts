import type { MatchDataSource } from "@scout-for-lol/domain/match-processing/states.ts";
import { ApplicationFailure } from "@temporalio/common";
import { matchEffectsAllowed } from "#src/evidence/admission.ts";
import type { RawMatch } from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutTournamentResultResult } from "@scout-for-lol/temporal/activity-contracts";
import {
  finalizeManagedCustomResult,
  findObservedCustomGame,
} from "#src/customs/riot-results.ts";
import { prisma } from "#src/database/index.ts";
import { resolveScoutMatchContext } from "#src/temporal/match/match-context.ts";

/**
 * Project a managed custom game's result before its cursor advances.
 *
 * v1 runs this between progression and the cursor write and is the only caller
 * repo-wide, so the V2 core has to run it too: once V2 owns such a match, a
 * missing finalization leaves the custom result unreported, while the
 * advanced cursor guarantees nothing rediscovers the match to fix it.
 *
 * The Activity and outcome names retain "tournament" for replay compatibility
 * with existing Temporal histories. Managed games are identified only by the
 * observed custom game bound to this match.
 *
 * Re-running is safe, which is what makes a crash between this stage and the
 * cursor recoverable: the result projector refuses to re-report a verified
 * game, so a resumed run cannot double-finalize.
 */
export async function finalizeTournamentResult(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutTournamentResultResult> {
  if (!(await matchEffectsAllowed(input.riotMatchId)))
    throw ApplicationFailure.nonRetryable(
      `Historical match ${input.riotMatchId} cannot finalize operational results`,
      "HistoryOnlyEffectDenied",
    );
  const context = await resolveScoutMatchContext(input.riotMatchId);
  return await finalizeTournamentMatch(
    context.matchData,
    context.matchDataSource,
  );
}

/**
 * The stage itself, over a match payload the caller already holds.
 *
 * Separated from the Activity so the gate and the idempotency can be exercised
 * against a real database without a Riot fetch; the Activity above is only the
 * payload resolution.
 */
export async function finalizeTournamentMatch(
  matchData: RawMatch,
  matchDataSource: MatchDataSource = "RIOT",
): Promise<ScoutTournamentResultResult> {
  // The same identity rule the finalizer uses, so the gate and the work can
  // never disagree about which custom game this match belongs to.
  const observedGame = await findObservedCustomGame(prisma, matchData);
  if (observedGame === null) {
    return { outcome: "not-a-tournament-match" };
  }

  const alreadyReported = observedGame.state === "VERIFIED";
  await finalizeManagedCustomResult(prisma, matchData, matchDataSource);

  // The retired Discord Activity was the only Custom Night snapshot audience,
  // so no snapshot is broadcast. The frozen result schema keeps the field.
  return alreadyReported
    ? { outcome: "already-finalized", publishedNight: false }
    : { outcome: "finalized", publishedNight: false };
}
