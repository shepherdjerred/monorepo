import { ApplicationFailure } from "@temporalio/common";
import {
  isArenaQueueOrMode,
  type PlayerConfigEntry,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutPrematchGameRef } from "@scout-for-lol/temporal/contracts-v2";
import { scoutPrematchGameV2MatchId } from "@scout-for-lol/temporal/identifiers";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { getAccountsWithState } from "#src/database/player-accounts.ts";
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
  return (
    isArenaQueueOrMode(gameInfo.gameQueueConfigId, gameInfo.gameMode) ||
    gameInfo.participants.length >= STANDARD_PARTICIPANT_COUNT
  );
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
 *
 * That failure is also why discovery may keep its guild filter while this may
 * not, rather than merely happening to be safe with it. Discovery pins the
 * reference to whichever account surfaced the game; a discovery set WIDER than
 * this one would name a puuid this resolver cannot find, and the capture would
 * die here non-retryably for a reason that is nothing to do with the game.
 * Reading every tracked account makes this roster a superset of any filtered
 * discovery set by construction, which closes that coupling in the one
 * direction it can be closed in.
 */
export async function resolveScoutV2PrematchContext(
  gameRef: ScoutPrematchGameRef,
): Promise<ScoutV2PrematchContext | null> {
  const configs = await trackedAccountConfigs();
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
  if (spectator.kind === "unavailable") {
    // No answer is not an answer of "no". Returning `null` here would let the
    // Workflow complete as a no-op, and its completed game-scoped ID would
    // then refuse every later poll — so one timeout, one 429 or one malformed
    // payload would cost this snapshot and its notifications permanently.
    // Throwing hands the wait to the Activity's retry policy, which is the
    // only thing in this path that can afford to be patient.
    throw new Error(
      `Riot's spectator API gave no usable answer for ${gameRef.puuid} (${spectator.reason}); retrying rather than recording a game that may well exist as absent`,
    );
  }
  if (spectator.kind === "not-in-game") return null;

  const gameInfo = spectator.game;
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
  return prematchContextFrom(
    gameInfo,
    configs,
    scoutPrematchGameV2MatchId(gameRef),
  );
}

/**
 * Every tracked account, as the task services take them, narrowed by no guild
 * filter at all.
 *
 * Deliberately NOT filtered by `getActiveServerIds()`, which the discovery poll
 * in `prematch-reads.ts` does still apply. The two reads ask different kinds of
 * question. Discovery's set decides how much WORK to do — which accounts are
 * worth spending a spectator read on — so widening it costs Riot budget and
 * nothing else, which is exactly what that helper's fail-open was written for.
 * This set decides who a durable fact is ABOUT: it becomes the audience
 * `recordPrematchDeliveryIntentsV2` mints intent rows for, and the tracked
 * puuids `recordClashPrematchSightings` writes sightings for. `getActiveServerIds`
 * reads the Discord gateway's guild cache, which answers `undefined` — no filter
 * — in a process that owns no gateway and a narrowed set in one that does, so a
 * cache-filtered roster would make the audience depend on WHICH PROCESS ASKS as
 * well as on when.
 *
 * What the filter actually cost is sharper than drift.
 * `getChannelsSubscribedToPlayers` looks accounts up by puuid with no guild
 * scope at all, and one puuid has one `Account` row per guild that registered
 * it. Dropping SOME guilds' copies therefore changed the audience not at all —
 * the surviving copy still reached every guild's subscriptions. It moved only
 * when EVERY guild holding that puuid was missing from the cache, and then the
 * puuid vanished whole and channels in guilds Scout is still in lost the
 * announcement. All-or-nothing per identity, silent, and unrecoverable for a
 * first capture attempt: `planPrematchFanOutV2` fans out only the rows that were
 * minted, and the completed game-scoped Workflow ID refuses every later poll.
 *
 * Guild liveness is still enforced, by the two things that decide it without
 * reading the cache: `reconcile-removed-guilds` deletes a removed guild's data
 * once two Discord-confirmed 10004s a day apart agree, and the delivery boundary
 * classifies a channel it cannot resolve. Between a removal and that sweep this
 * mints intents whose sends then fail and are classified — the same cost a
 * gatewayless process already pays today for every guild.
 */
export async function trackedAccountConfigs(
  database: ExtendedPrismaClient = prisma,
): Promise<PlayerConfigEntry[]> {
  const accounts = await getAccountsWithState(database);
  return accounts.map((account) => account.config);
}

/**
 * Build a capture context from a spectator payload, whatever produced it.
 *
 * Pure, and shared between the live read above and the resume path that reads
 * an already-archived snapshot back from S3. Both need the same answer — which
 * tracked accounts are in this game — and deriving it twice is how the two
 * paths would drift into minting intents for different sets of channels.
 *
 * Sharing the derivation is necessary and was never sufficient. It rules out
 * two hand-written filters going out of step; it cannot rule out one filter
 * answering differently on two runs. That is why `trackedAccountConfigs` reads
 * no gateway cache: a shared derivation over a process-dependent input still
 * lets the two paths mint for different sets of channels, which is precisely
 * the drift this comment claims to prevent.
 */
export function prematchContextFrom(
  gameInfo: RawCurrentGameInfo,
  configs: readonly PlayerConfigEntry[],
  riotMatchId: RiotMatchId,
): ScoutV2PrematchContext {
  const participants = new Set(
    gameInfo.participants.map((participant) => participant.puuid),
  );
  return {
    riotMatchId,
    gameInfo,
    trackedPlayers: configs.filter((config) =>
      participants.has(config.league.leagueAccount.puuid),
    ),
  };
}
