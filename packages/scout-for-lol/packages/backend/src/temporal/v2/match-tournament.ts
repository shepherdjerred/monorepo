import type { MatchId, RawMatch } from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutTournamentResultV2Result } from "@scout-for-lol/temporal/activity-contracts-v2";
import { finalizeAndPublishTournamentResult } from "#src/customs/riot-result-publication.ts";
import { tournamentLobbyIdentity } from "#src/customs/riot-results.ts";
import { prisma } from "#src/database/index.ts";
import { resolveScoutV2MatchContext } from "#src/temporal/v2/match-context.ts";

/**
 * Project a tournament-code custom game's result before its cursor advances.
 *
 * v1 runs this between progression and the cursor write and is the only caller
 * repo-wide, so the V2 core has to run it too: once V2 owns such a match, a
 * missing finalization leaves the tournament result unreported and the Custom
 * Night snapshot unpublished, while the advanced cursor guarantees nothing
 * rediscovers the match to fix it.
 *
 * It is its own stage rather than part of the observation because tournament
 * custom games and ordinary Riot match ingestion keep distinct provenance.
 * Most matches are not tournament games at all, and for those the whole stage
 * costs one indexed lobby lookup and says so.
 *
 * Re-running is safe, which is what makes a crash between this stage and the
 * cursor recoverable: `finalizeTournamentResult` refuses to re-report a lobby
 * already in `reported`, and the snapshot publish is a broadcast of current
 * state rather than an event, so a resumed run cannot double-finalize and
 * cannot deliver a duplicate anything.
 */
export async function finalizeTournamentResultV2(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutTournamentResultV2Result> {
  const context = await resolveScoutV2MatchContext(input.riotMatchId);
  return await finalizeTournamentMatchV2(context.matchId, context.matchData);
}

/**
 * The stage itself, over a match payload the caller already holds.
 *
 * Separated from the Activity so the gate and the idempotency can be exercised
 * against a real database without a Riot fetch; the Activity above is only the
 * payload resolution.
 */
export async function finalizeTournamentMatchV2(
  matchId: MatchId,
  matchData: RawMatch,
): Promise<ScoutTournamentResultV2Result> {
  // The same identity rule v1 finalizes on, so the gate and the work can never
  // disagree about which lobby this match belongs to.
  const identity = tournamentLobbyIdentity(
    matchId,
    matchData.info.tournamentCode,
  );
  const lobby = await prisma.tournamentLobby.findFirst({
    where: identity,
    select: { state: true },
  });
  if (lobby === null) {
    return { outcome: "not-a-tournament-match" };
  }

  const alreadyReported = lobby.state === "reported";
  await finalizeAndPublishTournamentResult(prisma, matchData);

  // Reported separately from the outcome because they are different claims:
  // whether THIS run finalized the result, and whether a Custom Night snapshot
  // went out at all. A reported lobby republishes its snapshot on every pass,
  // which is safe precisely because the snapshot is current state rather than
  // an event.
  const published = await prisma.tournamentLobby.findFirst({
    where: identity,
    select: { customGame: { select: { nightId: true } } },
  });
  const publishedNight = published?.customGame?.nightId != null;
  return alreadyReported
    ? { outcome: "already-finalized", publishedNight }
    : { outcome: "finalized", publishedNight };
}
