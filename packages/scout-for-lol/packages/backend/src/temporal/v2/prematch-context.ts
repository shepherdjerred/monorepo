import { ApplicationFailure } from "@temporalio/common";
import {
  isArenaQueueOrMode,
  type PlayerConfigEntry,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutPrematchGameRef } from "@scout-for-lol/temporal/contracts-v2";
import { scoutPrematchGameV2MatchId } from "@scout-for-lol/temporal/identifiers";
import { getAccountsWithState, prisma } from "#src/database/index.ts";
import { getActiveServerIds } from "#src/discord/utils/guild-membership.ts";
import { getActiveGame } from "#src/league/api/spectator.ts";

/**
 * What every V2 prematch Activity needs before it can do anything: the live
 * spectator payload for one game, and which tracked accounts are in it.
 *
 * The Activity resolves this for itself from the game REFERENCE rather than
 * receiving a payload from the Workflow, for the same reason the per-match
 * core resolves its own MatchV5 payload: a spectator snapshot in a Workflow
 * history is kept forever, and an Activity that depended on a previous one's
 * in-memory payload could not be rescheduled onto another worker after a
 * crash.
 */
export type ScoutV2PrematchContext = {
  readonly riotMatchId: RiotMatchId;
  readonly gameInfo: RawCurrentGameInfo;
  /** Every tracked account playing in this game. */
  readonly trackedPlayers: PlayerConfigEntry[];
};

const STANDARD_PARTICIPANT_COUNT = 10;

/**
 * Whether the spectator payload describes a game whose roster has finished
 * filling.
 *
 * Riot surfaces a game during its pre-game countdown, when it reports fewer
 * than ten participants because not everyone has loaded in; Arena is exempt
 * because its rosters are 16 or 18 and its own schema validates them. This
 * restates v1's `isLikelyPreStartLobby` (in `active-game-detection.ts`, where
 * it is private) because V2's two prematch Activities both need it and must
 * agree: discovery refuses to surface a partial lobby, and capture refuses to
 * archive one.
 *
 * Refusing matters more than it looks. The per-game Workflow ID is claimed by
 * the first run that takes the game, so a run that archived a half-filled
 * roster would own that ID with a snapshot missing tracked players, and every
 * later poll would be deduplicated against it.
 */
export function isPrematchRosterComplete(
  gameInfo: RawCurrentGameInfo,
): boolean {
  if (isArenaQueueOrMode(gameInfo.gameQueueConfigId, gameInfo.gameMode)) {
    return true;
  }
  return gameInfo.participants.length >= STANDARD_PARTICIPANT_COUNT;
}

/**
 * Re-fetch one discovered game, or report that it is no longer live.
 *
 * `null` means there is nothing to capture and never will be: the account
 * left, or the game ended between the poll that discovered it and this run.
 * That is an external-boundary answer rather than a failure — the pipeline
 * missed a game, which the next poll cannot fix by retrying.
 *
 * An unfilled roster is the opposite: the game IS there and the payload is
 * merely early. Throwing hands the wait to the Activity's retry policy, which
 * is v1's in-process `refetchLobbyUntilFilled` loop done durably — the
 * backoff covers the loading screen, and a worker that dies waiting does not
 * take the wait with it.
 *
 * The region comes from the account named in the reference because that is
 * what the reference records the puuid FOR: the spectator read is issued
 * against that account, and an account no longer tracked makes the reference
 * stale rather than the game unreachable. The next poll surfaces the same game
 * under another tracked account's puuid, and `ALLOW_DUPLICATE_FAILED_ONLY`
 * lets that run replace this failed one on the same Workflow ID.
 */
export async function resolveScoutV2PrematchContext(
  gameRef: ScoutPrematchGameRef,
): Promise<ScoutV2PrematchContext | null> {
  const accounts = await getAccountsWithState(prisma, getActiveServerIds());
  const configs = accounts.map((account) => account.config);
  const surfacedBy = configs.find(
    (config) => config.league.leagueAccount.puuid === gameRef.puuid,
  );
  if (surfacedBy === undefined) {
    throw ApplicationFailure.nonRetryable(
      `No tracked account has puuid ${gameRef.puuid}, so the spectator read for ${gameRef.platform}_${gameRef.gameId} cannot be re-issued`,
      "MissingDomainRecord",
    );
  }

  const spectator = await getActiveGame(
    gameRef.puuid,
    surfacedBy.league.leagueAccount.region,
  );
  if (spectator.upstreamError) {
    throw new Error(
      `Riot's spectator API could not be reached for ${gameRef.puuid}; retrying rather than reporting a game that is not there`,
    );
  }
  const gameInfo = spectator.game;
  if (gameInfo === undefined) return null;
  if (
    gameInfo.platformId !== gameRef.platform ||
    gameInfo.gameId.toString() !== gameRef.gameId
  ) {
    // The account is in a DIFFERENT game now, so the discovered one is over.
    // The new one is not this execution's to take: its Workflow ID is another
    // game's, and the next poll starts it there.
    return null;
  }
  if (!isPrematchRosterComplete(gameInfo)) {
    throw new Error(
      `Spectator payload for ${gameRef.platform}_${gameRef.gameId} still reports ${gameInfo.participants.length.toString()} participants; retrying until the roster fills`,
    );
  }

  const participants = new Set(
    gameInfo.participants.map((participant) => participant.puuid),
  );
  return {
    riotMatchId: scoutPrematchGameV2MatchId(gameRef),
    gameInfo,
    trackedPlayers: configs.filter((config) =>
      participants.has(config.league.leagueAccount.puuid),
    ),
  };
}
