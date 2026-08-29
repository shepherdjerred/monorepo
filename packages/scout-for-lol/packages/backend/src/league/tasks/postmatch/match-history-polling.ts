import type {
  RawMatch,
  PlayerConfigEntry,
  LeaguePuuid,
  MatchId,
  DiscordChannelId,
  DiscordGuildId,
} from "@scout-for-lol/data/index.ts";
import {
  getRecentMatchIds,
  filterNewMatches,
} from "#src/league/api/match-history.ts";
import {
  getAccountsWithState,
  updateLastProcessedMatch,
  getChannelsSubscribedToPlayers,
  getLastProcessedMatch,
  updateLastCheckedAt,
  prisma,
} from "#src/database/index.ts";
import {
  MatchIdSchema,
  DiscordGuildIdSchema,
  resolveQueueTypeFromGame,
} from "@scout-for-lol/data/index.ts";
import {
  channelsPassingQueueFilter,
  deliverToChannels,
} from "#src/league/tasks/notification-filters.ts";
import { getActiveServerIds } from "#src/discord/utils/guild-membership.ts";
import {
  shouldCheckPlayer,
  calculatePollingInterval,
} from "#src/utils/polling-intervals.ts";
import { MAX_PLAYERS_PER_RUN } from "@scout-for-lol/data/polling-config.ts";
import { generateMatchReport } from "#src/league/tasks/postmatch/match-report-generator.ts";
import {
  processMatchForPlayer,
  type PlayerWithMatchIds,
  type ProcessMatchUpdateOptions,
} from "#src/league/tasks/postmatch/match-processing.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { announceSettlements } from "#src/betting/announce.ts";
import { settleAndAwardBucks } from "#src/betting/postmatch-hook.ts";
import { uniqueBy } from "remeda";
import { matchHistoryPollingSkipsTotal } from "#src/metrics/index.ts";
import { setLastSuccessfulPollAt } from "#src/league/tasks/recovery/app-state.ts";
import { recordMatchForReportStore } from "#src/report-store/live-ingest.ts";
import { recoverMissedMatches } from "#src/league/tasks/postmatch/gap-recovery.ts";
import {
  getPostmatchMessageIdsForMatchIdOrEmpty,
  getPrematchMessageIdsForMatchIdOrEmpty,
  recordPostmatchMessageIds,
} from "#src/league/tasks/prematch/active-game-queries.ts";
import { recordCoreOutputsDelivered } from "#src/analytics/guild-lifecycle.ts";
import { getPuuidsBlockedFromLivePolling } from "#src/league/initial-history/live-polling.ts";
import {
  deduplicateMatchIntents,
  type DiscoveredMatchIntent,
  type MatchDiscovery,
} from "#src/league/tasks/postmatch/match-intents.ts";
import {
  claimScoutEffect,
  completeScoutEffect,
  recordScoutEffectFailure,
} from "#src/temporal/effect-claims.ts";
import { finalizeTournamentResult } from "#src/customs/riot-results.ts";

const logger = createLogger("postmatch-match-history-polling");

let isPollingInProgress = false;
let pollingStartTime: number | undefined;

// Suppress stale Discord notifications and AI reviews after recovery.
const MAX_DISCORD_ALERT_AGE_MS = 3 * 60 * 60 * 1000;

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
 * Process a completed match and send Discord notifications
 */
async function processMatch(
  matchData: RawMatch,
  trackedPlayers: PlayerConfigEntry[],
): Promise<Map<DiscordChannelId, string>> {
  const matchId = MatchIdSchema.parse(matchData.metadata.matchId);

  const playersInMatch = trackedPlayers.filter((player) =>
    matchData.metadata.participants.includes(player.league.leagueAccount.puuid),
  );

  const puuids: LeaguePuuid[] = playersInMatch.map(
    (p) => p.league.leagueAccount.puuid,
  );
  const channels = await getChannelsSubscribedToPlayers(puuids);

  // Resolve queue + apply per-subscription filters; deliver only to channels
  // with at least one passing in-match subscription (covers "no subscribers"
  // too, since that yields no delivery channels).
  const queueType = resolveQueueTypeFromGame(
    matchData.info.queueId,
    matchData.info.gameMode,
    matchData.info.gameType,
  );
  const deliverChannels = channelsPassingQueueFilter(channels, queueType);
  if (deliverChannels.length === 0) {
    logger.info(
      `[processMatch] 🔕 No delivery channels for match ${matchId} (queue ${queueType ?? "unknown"}, ${channels.length.toString()} subscribed)`,
    );
    return new Map();
  }

  const targetGuildIds: DiscordGuildId[] = uniqueBy(
    deliverChannels.map((c) => DiscordGuildIdSchema.parse(c.serverId)),
    (id) => id,
  );

  const matchAgeMs = Date.now() - matchData.info.gameCreation;
  if (matchAgeMs > MAX_DISCORD_ALERT_AGE_MS) {
    const ageHours = (matchAgeMs / (60 * 60 * 1000)).toFixed(1);
    logger.info(
      `[processMatch] ⏰ Skipping match ${matchId} — ${ageHours}h old (cutoff ${(MAX_DISCORD_ALERT_AGE_MS / (60 * 60 * 1000)).toString()}h)`,
    );
    return new Map();
  }

  const message = await generateMatchReport(matchData, trackedPlayers, {
    targetGuildIds,
  });

  if (!message) {
    logger.info(`[processMatch] ⚠️  No message generated for match ${matchId}`);
    return new Map();
  }

  const delivery = await deliverToChannels({
    message,
    channels: deliverChannels,
    logPrefix: "[processMatch]",
    sentryTags: { matchId },
    replyToMessageIds: await getPrematchMessageIdsForMatchIdOrEmpty(matchId),
    effectKeyPrefix: `postmatch-discord:${matchId}`,
  });
  await recordCoreOutputsDelivered(delivery.deliveredGuildIds, "postmatch");
  // Durable so a settlement announced by a later process can still reply to
  // the report. Best-effort by design: the report is already delivered.
  await recordPostmatchMessageIds(matchId, delivery.messageIdsByChannel);
  return delivery.messageIdsByChannel;
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
  const bucks = await settleAndAwardBucks(matchData);
  let postmatchMessageIds: ReadonlyMap<string, string> = new Map();

  if (!silent) {
    // Report generation runs only AFTER the durable copy succeeded. A
    // downstream failure (satori render crash, model error, Discord send
    // failure) still swallows + advances: the authoritative S3 write already
    // succeeded, and these failures are deterministic — retrying every poll
    // would re-run the whole AI pipeline and burn tokens for nothing.
    try {
      postmatchMessageIds = await processMatch(matchData, allTrackedPlayers);
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

  // This is the last transactional extension point before player cursors move
  // past the match. Tournament lobbies — and linked Customs games — finalize
  // here, after authoritative S3 ingest and post-match side effects. A failure
  // therefore leaves the cursors in place and retries the same match.
  await finalizeTournamentResult(prisma, matchData);

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

type AccountWithState = {
  config: PlayerConfigEntry;
  lastMatchTime: Date | undefined;
  lastCheckedAt: Date | undefined;
};

/**
 * Collect new matches for each player, handling gap detection and backfill recovery.
 */
async function collectNewMatches(
  playersToCheck: AccountWithState[],
  currentTime: Date,
): Promise<PlayerWithMatchIds[]> {
  const playersWithMatches: PlayerWithMatchIds[] = [];

  for (const {
    config: player,
    lastMatchTime,
    lastCheckedAt,
  } of playersToCheck) {
    const puuid = player.league.leagueAccount.puuid;
    const interval = calculatePollingInterval(lastMatchTime, currentTime);

    logger.info(
      `[${player.alias}] 🔍 Checking match history (interval: ${interval.toString()}min, last match: ${lastMatchTime ? lastMatchTime.toISOString() : "never"}, last checked: ${lastCheckedAt ? lastCheckedAt.toISOString() : "never"})`,
    );

    try {
      const lastProcessedMatchId = await getLastProcessedMatch(puuid);
      const recentMatchIds = await getRecentMatchIds(player, 5);
      await updateLastCheckedAt(puuid, currentTime);

      if (!recentMatchIds || recentMatchIds.length === 0) {
        logger.info(`[${player.alias}] ℹ️  No recent matches found`);
        continue;
      }

      const { matchIds: newMatchIds, gapDetected } = filterNewMatches(
        recentMatchIds,
        lastProcessedMatchId,
      );

      if (newMatchIds.length === 0) {
        logger.info(`[${player.alias}] ✅ No new matches to process`);
        continue;
      }

      let discordMatchIds: MatchId[];
      let backfillMatchIds: MatchId[] = [];

      if (gapDetected) {
        const recovered = await recoverMissedMatches(player, newMatchIds);
        discordMatchIds = recovered.discordMatchIds;
        backfillMatchIds = recovered.backfillMatchIds;
      } else {
        discordMatchIds = newMatchIds;
      }

      logger.info(
        `[${player.alias}] 🆕 Found ${discordMatchIds.length.toString()} new match(es) for Discord: ${discordMatchIds.join(", ")}`,
      );
      playersWithMatches.push({
        player,
        matchIds: discordMatchIds,
        backfillMatchIds,
      });
    } catch (error) {
      logger.error(`[${player.alias}] ❌ Error checking match history:`, error);
      Sentry.captureException(error, {
        tags: {
          source: "match-history-check",
          playerAlias: player.alias,
          puuid,
        },
      });
    }
  }

  return playersWithMatches;
}

async function collectMatchDiscovery(): Promise<MatchDiscovery> {
  const [allAccountsWithState, blockedPuuids] = await prisma.$transaction(
    async (tx) =>
      await Promise.all([
        getAccountsWithState(tx, getActiveServerIds()),
        getPuuidsBlockedFromLivePolling(tx),
      ]),
    { isolationLevel: "RepeatableRead" },
  );
  const accountsWithState = allAccountsWithState.filter(
    ({ config }) => !blockedPuuids.has(config.league.leagueAccount.puuid),
  );
  logger.info(
    `📊 Found ${accountsWithState.length.toString()} pollable player account(s); ${blockedPuuids.size.toString()} PUUID(s) are completing initial history import`,
  );

  const currentTime = new Date();
  const eligiblePlayers = accountsWithState.filter(
    ({ lastMatchTime, lastCheckedAt }) =>
      shouldCheckPlayer(lastMatchTime, lastCheckedAt, currentTime),
  );
  const sortedEligiblePlayers = eligiblePlayers.toSorted((a, b) => {
    if (a.lastCheckedAt === undefined && b.lastCheckedAt === undefined)
      return 0;
    if (a.lastCheckedAt === undefined) return -1;
    if (b.lastCheckedAt === undefined) return 1;
    return a.lastCheckedAt.getTime() - b.lastCheckedAt.getTime();
  });
  const playersToCheck = sortedEligiblePlayers.slice(0, MAX_PLAYERS_PER_RUN);
  logger.info(
    `📊 Checking ${playersToCheck.length.toString()} / ${eligiblePlayers.length.toString()} eligible account(s) this run`,
  );
  const playersWithMatches = await collectNewMatches(
    playersToCheck,
    currentTime,
  );
  return {
    intents: deduplicateMatchIntents(playersWithMatches),
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
