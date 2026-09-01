import type { MatchId } from "@scout-for-lol/data/index.ts";
import {
  getRecentMatchIds,
  filterNewMatches,
} from "#src/league/api/match-history.ts";
import {
  getAccountsWithState,
  updateLastProcessedMatch,
  getLastProcessedMatch,
  updateLastCheckedAt,
  prisma,
} from "#src/database/index.ts";
import { MatchIdSchema } from "@scout-for-lol/data/index.ts";
import { getActiveServerIds } from "#src/discord/utils/guild-membership.ts";
import { calculatePollingInterval } from "#src/utils/polling-intervals.ts";
import { MAX_PLAYERS_PER_RUN } from "@scout-for-lol/data/polling-config.ts";
import {
  processMatchForPlayer,
  type PlayerWithMatchIds,
  type ProcessMatchUpdateOptions,
} from "#src/league/tasks/postmatch/match-processing.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { announceSettlements } from "#src/betting/announce.ts";
import { deliverDareSummaries } from "#src/betting/dare-delivery.ts";
import type { settleAndAwardBucks } from "#src/betting/postmatch-hook.ts";
import { settleBucksWithDareTimelineV2 } from "#src/betting/dare-postmatch-timeline-v2.ts";
import { matchHistoryPollingSkipsTotal } from "#src/metrics/index.ts";
import { setLastSuccessfulPollAt } from "#src/league/tasks/recovery/app-state.ts";
import { recordMatchForReportStore } from "#src/report-store/live-ingest.ts";
import { recoverMissedMatches } from "#src/league/tasks/postmatch/gap-recovery.ts";
import { getPostmatchMessageIdsForMatchIdOrEmpty } from "#src/league/tasks/prematch/active-game-queries.ts";
import { getPuuidsBlockedFromLivePolling } from "#src/league/initial-history/live-polling.ts";
import {
  deduplicateMatchIntents,
  orderMatchIntentsByCompletion,
  type DiscoveredMatchIntent,
  type MatchDiscovery,
} from "#src/league/tasks/postmatch/match-intents.ts";
import {
  claimScoutEffect,
  completeScoutEffect,
  recordScoutEffectFailure,
} from "#src/temporal/effect-claims.ts";
import { finalizeAndPublishTournamentResult } from "#src/customs/riot-result-publication.ts";
import { deliverPostmatchReport } from "#src/league/tasks/postmatch/match-report-delivery.ts";
import { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import {
  activeDareTargetPuuids,
  selectMatchPollAccounts,
  type MatchPollAccount,
} from "#src/league/tasks/postmatch/match-discovery-selection.ts";

const logger = createLogger("postmatch-match-history-polling");

let isPollingInProgress = false;
let pollingStartTime: number | undefined;

export const isMatchHistoryPollingInProgress = (): boolean =>
  isPollingInProgress;

export function resetPollingState(): void {
  isPollingInProgress = false;
  pollingStartTime = undefined;
}

type BucksPostmatchResult = Awaited<ReturnType<typeof settleAndAwardBucks>>;

export function shouldAnnounceBucks(input: {
  silent: boolean;
  bucks: BucksPostmatchResult;
}): boolean {
  return (
    !input.silent ||
    input.bucks.closures.some((pool) => pool.positions.length > 0) ||
    input.bucks.settlements.some((summary) =>
      summary.bets.some((bet) => !bet.isHouse),
    ) ||
    input.bucks.parlaySettlements.some((summary) => summary.bets.length > 0)
  );
}

function shouldSkipPollingRun(): boolean {
  if (!isPollingInProgress) {
    return false;
  }

  const elapsed =
    pollingStartTime === undefined ? 0 : Date.now() - pollingStartTime;

  // Check if the lock is stale (stuck for over 5 minutes)
  if (elapsed > 5 * 60 * 1000) {
    logger.error(
      `⚠️  Polling lock timeout detected after ${Math.round(elapsed / 1000).toString()}s, force-resetting stale lock`,
    );
    matchHistoryPollingSkipsTotal.inc({ reason: "timeout_reset" });
    Sentry.captureMessage("Match history polling lock timeout - force reset", {
      level: "warning",
      tags: { source: "match-history-polling" },
      extra: { elapsedMs: elapsed },
    });
    isPollingInProgress = false;
    pollingStartTime = undefined;
    return false;
  }

  logger.info(
    `⏸️  Match history polling already in progress (${Math.round(elapsed / 1000).toString()}s elapsed), skipping this run`,
  );
  matchHistoryPollingSkipsTotal.inc({ reason: "concurrent_run" });
  return true;
}

/**
 * Process match and update all tracked players who participated
 */
export async function processMatchAndUpdatePlayers(
  options: ProcessMatchUpdateOptions,
): Promise<void> {
  const {
    matchData,
    allPlayerConfigs,
    processedMatchIds,
    matchId,
    silent = false,
  } = options;

  // Get all tracked players in this match
  const allTrackedPlayers = allPlayerConfigs.filter((p) =>
    matchData.metadata.participants.includes(p.league.leagueAccount.puuid),
  );

  logger.info(
    `[processMatch] 🔍 ${allTrackedPlayers.length.toString()} tracked player(s) in match: ${allTrackedPlayers.map((p) => p.alias).join(", ")}`,
  );

  // Authoritative S3 ingest GATES the cursor. S3 is the canonical raw store, so
  // a failed write here is NOT deterministic (transient SeaweedFS/network
  // outage) — advancing the cursor past it would lose the match forever. On
  // failure we RETURN before marking processed / advancing the cursor, so the
  // next poll retries. `backfill-to-s3.ts` (Riot re-fetch) is the recovery net.
  const aliases = allTrackedPlayers.map((p) => p.alias);
  const rawMatchEffectKey = `raw-match-s3:${matchId}`;
  let rawMatchClaimed = false;
  try {
    const claim = await claimScoutEffect({
      key: rawMatchEffectKey,
      kind: "raw-match-s3",
    });
    if (claim === "execute") {
      rawMatchClaimed = true;
      await recordMatchForReportStore({
        match: matchData,
        source: silent ? "postmatch_silent_backfill" : "postmatch_live",
        trackedPlayerAliases: aliases,
      });
      await completeScoutEffect(rawMatchEffectKey);
    }
  } catch (error) {
    if (rawMatchClaimed) {
      await recordScoutEffectFailure(rawMatchEffectKey, error);
    }
    logger.error(
      `[processMatch] ❌ Authoritative S3 ingest failed for ${matchId} — NOT advancing cursor; will retry next poll`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "report-store-ingest-gate", matchId },
    });
    throw error;
  }

  // After the S3 gate and OUTSIDE `!silent`: Bucks are owed for the game even
  // when the ordinary match report is suppressed. See settleAndAwardBucks.
  const { bucks, prefetchedTimeline } = await settleBucksWithDareTimelineV2({
    matchData,
    trackedPlayers: allTrackedPlayers,
    prismaClient: prisma,
  });
  let postmatchMessageIds: ReadonlyMap<string, string> = new Map();

  if (!silent) {
    // Report generation runs only AFTER the durable copy succeeded. A
    // downstream failure (satori render crash, model error, Discord send
    // failure) still swallows + advances: the authoritative S3 write already
    // succeeded, and these failures are deterministic — retrying every poll
    // would re-run the whole AI pipeline and burn tokens for nothing.
    try {
      postmatchMessageIds = await deliverPostmatchReport({
        matchData,
        trackedPlayers: allTrackedPlayers,
        ...(prefetchedTimeline === undefined ? {} : { prefetchedTimeline }),
      });
    } catch (error) {
      logger.error(
        `[processMatch] ❌ processMatch threw for ${matchId} — cursor will still advance (durable S3 copy already saved)`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "process-match-throw", matchId },
      });
    }
  }

  if (shouldAnnounceBucks({ silent, bucks })) {
    // A silent match skips processMatch entirely, and a restart between the
    // report and this announcement loses the in-memory map. Either way the
    // durable copy is the only remaining reply target.
    if (postmatchMessageIds.size === 0) {
      postmatchMessageIds =
        await getPostmatchMessageIdsForMatchIdOrEmpty(matchId);
    }

    // Announced after the report so it reads as a follow-up, and as its own
    // message rather than appended to the report's content, which the AI review
    // already owns and which is delivered to every guild at once. A silent
    // match still announces actual betting allocations or payouts: suppressing
    // a stale report must not hide what happened to reserved BB.
    //
    // Its own error boundary, NOT the report's: the pool is already committed
    // as settled and a later pass returns no summary, so this announcement is
    // one-shot. Sharing a `try` with report generation and Discord delivery
    // meant a render crash or a failed send discarded the settlement summary
    // outright, and the bettors were never told what happened to their stakes.
    await announceSettlements({
      matchId,
      closures: bucks.closures,
      settlements: bucks.settlements,
      parlaySettlements: bucks.parlaySettlements,
      earnings: bucks.earnings,
      postmatchMessageIds,
    });
  }

  // Dare results are one-shot like the settlement summary: a later pass
  // returns nothing for an already-settled dare, so this delivery must not
  // share an error boundary with anything else. It swallows per-summary and
  // never blocks the cursor; a silent match still announces, because a dare
  // resolution moved real balances regardless of report suppression.
  await deliverDareSummaries(bucks.dareSettlements);

  // This is the last transactional extension point before player cursors move
  // past the match. Tournament lobbies — and linked Customs games — finalize
  // here, after authoritative S3 ingest and post-match side effects. A failure
  // therefore leaves the cursors in place and retries the same match.
  await finalizeAndPublishTournamentResult(prisma, matchData);

  // Mark as processed
  processedMatchIds.add(matchId);

  // Update lastProcessedMatchId and lastMatchTime for all players in this match
  // (single updateMany per player). Reached only after authoritative S3 ingest.
  const matchCreationTime = new Date(matchData.info.gameCreation);
  for (const trackedPlayer of allTrackedPlayers) {
    const playerPuuid = trackedPlayer.league.leagueAccount.puuid;
    const brandedMatchId = MatchIdSchema.parse(matchId);
    await updateLastProcessedMatch(
      playerPuuid,
      brandedMatchId,
      undefined,
      matchCreationTime,
    );
  }
}

/**
 * Collect new matches for each player, handling gap detection and backfill recovery.
 */
async function collectNewMatchesForPlayer(
  account: MatchPollAccount,
  currentTime: Date,
): Promise<PlayerWithMatchIds | undefined> {
  const { config: player, lastMatchTime, lastCheckedAt } = account;
  const puuid = player.league.leagueAccount.puuid;
  const interval = calculatePollingInterval(lastMatchTime, currentTime);
  logger.info(
    `[${player.alias}] 🔍 Checking match history (interval: ${interval.toString()}min, last match: ${lastMatchTime ? lastMatchTime.toISOString() : "never"}, last checked: ${lastCheckedAt ? lastCheckedAt.toISOString() : "never"})`,
  );

  const lastProcessedMatchId = await getLastProcessedMatch(puuid);
  const recentMatchIds = await getRecentMatchIds(player, 5);
  if (recentMatchIds === undefined) {
    throw new Error(`Match history is unavailable for ${puuid}`);
  }
  await updateLastCheckedAt(puuid, currentTime);
  if (recentMatchIds.length === 0) {
    logger.info(`[${player.alias}] ℹ️  No recent matches found`);
    return;
  }

  const { matchIds: newMatchIds, gapDetected } = filterNewMatches(
    recentMatchIds,
    lastProcessedMatchId,
  );
  if (newMatchIds.length === 0) {
    logger.info(`[${player.alias}] ✅ No new matches to process`);
    return;
  }

  const recovered = gapDetected
    ? await recoverMissedMatches(player, newMatchIds)
    : { discordMatchIds: newMatchIds, backfillMatchIds: [] };
  logger.info(
    `[${player.alias}] 🆕 Found ${recovered.discordMatchIds.length.toString()} new match(es) for Discord: ${recovered.discordMatchIds.join(", ")}`,
  );
  return {
    player,
    matchIds: recovered.discordMatchIds,
    backfillMatchIds: recovered.backfillMatchIds,
  };
}

async function collectNewMatches(
  playersToCheck: MatchPollAccount[],
  currentTime: Date,
  requiredDarePuuids: ReadonlySet<string>,
): Promise<PlayerWithMatchIds[]> {
  const playersWithMatches: PlayerWithMatchIds[] = [];

  for (const account of playersToCheck) {
    const player = account.config;
    const puuid = player.league.leagueAccount.puuid;
    try {
      const matches = await collectNewMatchesForPlayer(account, currentTime);
      if (matches !== undefined) playersWithMatches.push(matches);
    } catch (error) {
      logger.error(`[${player.alias}] ❌ Error checking match history:`, error);
      Sentry.captureException(error, {
        tags: {
          source: "match-history-check",
          playerAlias: player.alias,
          puuid,
        },
      });
      if (requiredDarePuuids.has(puuid)) {
        throw new Error(
          `Active Dare v2 target history poll failed for ${puuid}`,
          { cause: error },
        );
      }
    }
  }

  return playersWithMatches;
}

async function collectMatchDiscovery(): Promise<MatchDiscovery> {
  const [allAccountsWithState, blockedPuuids, activeDareTargets] =
    await prisma.$transaction(
      async (tx) =>
        await Promise.all([
          getAccountsWithState(tx, getActiveServerIds()),
          getPuuidsBlockedFromLivePolling(tx),
          tx.bucksDareV2Target.findMany({
            where: { dare: { dareState: "active" } },
            select: { accounts: true },
          }),
        ]),
      { isolationLevel: "RepeatableRead" },
    );
  const requiredDarePuuids = activeDareTargetPuuids(activeDareTargets);
  const accountsWithState = allAccountsWithState.filter(
    ({ config }) => !blockedPuuids.has(config.league.leagueAccount.puuid),
  );
  logger.info(
    `📊 Found ${accountsWithState.length.toString()} pollable player account(s); ${blockedPuuids.size.toString()} PUUID(s) are completing initial history import; ${requiredDarePuuids.size.toString()} active Dare account(s) are mandatory`,
  );

  const currentTime = new Date();
  const playersToCheck = selectMatchPollAccounts({
    accounts: accountsWithState,
    requiredPuuids: requiredDarePuuids,
    currentTime,
    ordinaryLimit: MAX_PLAYERS_PER_RUN,
  });
  logger.info(
    `📊 Checking ${playersToCheck.length.toString()} unique account(s) this run`,
  );
  const playersWithMatches = await collectNewMatches(
    playersToCheck,
    currentTime,
    requiredDarePuuids,
  );
  const intents = deduplicateMatchIntents(playersWithMatches);
  const orderedIntents = await orderMatchIntentsByCompletion(
    intents,
    async (intent) => {
      const match = await fetchMatchData(
        MatchIdSchema.parse(intent.matchId),
        intent.region,
      );
      if (match === undefined) {
        throw new Error(
          `Could not establish completion time for ${intent.matchId}; refusing the discovery batch`,
        );
      }
      return match.info.gameEndTimestamp;
    },
  );
  return {
    intents: orderedIntents,
    allPlayerConfigs: accountsWithState.map((account) => account.config),
  };
}

export async function discoverPostMatchIntents(): Promise<
  DiscoveredMatchIntent[]
> {
  if (shouldSkipPollingRun()) return [];
  isPollingInProgress = true;
  pollingStartTime = Date.now();
  try {
    const discovery = await collectMatchDiscovery();
    await setLastSuccessfulPollAt(new Date());
    return discovery.intents;
  } finally {
    isPollingInProgress = false;
    pollingStartTime = undefined;
  }
}

/**
 * Main function to check for new matches via match history polling
 */
export async function checkMatchHistory(): Promise<void> {
  // Prevent concurrent runs to avoid race conditions where two cron runs
  // could process the same match before lastProcessedMatchId is updated
  if (shouldSkipPollingRun()) {
    return;
  }

  isPollingInProgress = true;
  pollingStartTime = Date.now();
  logger.info("🔍 Starting match history polling check");
  const startTime = Date.now();

  try {
    const discovery = await collectMatchDiscovery();
    if (discovery.intents.length === 0) {
      logger.info("✅ No new matches found for any players");
      const totalTime = Date.now() - startTime;
      logger.info(
        `⏱️  Match history check completed in ${totalTime.toString()}ms`,
      );
      await setLastSuccessfulPollAt(new Date());
      return;
    }

    const totalDiscord = discovery.intents.filter(
      (intent) => intent.delivery === "live",
    ).length;
    const totalBackfill = discovery.intents.length - totalDiscord;
    logger.info(
      `🎮 Processing ${totalDiscord.toString()} Discord match(es) + ${totalBackfill.toString()} backfill match(es)`,
    );
    const processedMatchIds = new Set<MatchId>();
    for (const intent of discovery.intents) {
      const player = discovery.allPlayerConfigs.find(
        (candidate) =>
          candidate.league.leagueAccount.puuid === intent.sourcePuuid,
      );
      if (player === undefined) {
        throw new Error(`Discovery source ${intent.sourcePuuid} disappeared`);
      }
      await processMatchForPlayer({
        player,
        matchId: MatchIdSchema.parse(intent.matchId),
        allPlayerConfigs: discovery.allPlayerConfigs,
        processedMatchIds,
        processMatchAndUpdatePlayers,
        silent: intent.delivery === "silent-backfill",
      });
    }

    const totalTime = Date.now() - startTime;
    logger.info(
      `✅ Match history check completed in ${totalTime.toString()}ms`,
    );
    logger.info(
      `📊 Processed ${processedMatchIds.size.toString()} unique match(es)`,
    );

    await setLastSuccessfulPollAt(new Date());
  } catch (error) {
    logger.error("❌ Error in match history check:", error);
    throw error;
  } finally {
    isPollingInProgress = false;
    pollingStartTime = undefined;
  }
}
