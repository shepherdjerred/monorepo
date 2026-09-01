import type { MatchId } from "@scout-for-lol/data/index.ts";
import {
  getAccountsWithState,
  updateLastProcessedMatch,
  prisma,
} from "#src/database/index.ts";
import { MatchIdSchema } from "@scout-for-lol/data/index.ts";
import { getActiveServerIds } from "#src/discord/utils/guild-membership.ts";
import { MAX_PLAYERS_PER_RUN } from "@scout-for-lol/data/polling-config.ts";
import {
  processMatchForPlayer,
  type ProcessMatchUpdateOptions,
} from "#src/league/tasks/postmatch/match-processing.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { announceSettlements } from "#src/betting/announce.ts";
import { deliverDareSummaries } from "#src/betting/dare-delivery.ts";
import {
  voidDareV2WithFullRefund,
  type RefundableDareV2Row,
} from "#src/betting/dare-void-v2.ts";
import type { settleAndAwardBucks } from "#src/betting/postmatch-hook.ts";
import { settleBucksWithDareTimelineV2 } from "#src/betting/dare-postmatch-timeline-v2.ts";
import { matchHistoryPollingSkipsTotal } from "#src/metrics/index.ts";
import { setLastSuccessfulPollAt } from "#src/league/tasks/recovery/app-state.ts";
import { recordMatchForReportStore } from "#src/report-store/live-ingest.ts";
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
import { collectNewMatches } from "#src/league/tasks/postmatch/match-history-collection.ts";
import {
  activeDareTargetPuuids,
  selectMatchPollAccounts,
  unavailableRequiredPuuids,
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

async function recoverUnavailableActiveDares(input: {
  activeDares: readonly RefundableDareV2Row[];
  accounts: readonly MatchPollAccount[];
  currentTime: Date;
}): Promise<Set<string>> {
  const requiredPuuids = new Set<string>();
  for (const dare of input.activeDares) {
    const darePuuids = activeDareTargetPuuids(dare.targets);
    const unavailable = unavailableRequiredPuuids({
      accounts: input.accounts,
      requiredPuuids: darePuuids,
    });
    if (unavailable.length > 0) {
      logger.warn(
        `Voiding Dare ${dare.id.toString()} because frozen target account(s) are unavailable: ${unavailable.join(", ")}`,
      );
      await voidDareV2WithFullRefund(
        dare,
        "target_unavailable",
        prisma,
        input.currentTime,
      );
      continue;
    }
    for (const puuid of darePuuids) requiredPuuids.add(puuid);
  }
  return requiredPuuids;
}

async function collectMatchDiscovery(): Promise<MatchDiscovery> {
  const currentTime = new Date();
  const [allAccountsWithState, blockedPuuids, activeDares] =
    await prisma.$transaction(
      async (tx) =>
        await Promise.all([
          getAccountsWithState(tx, getActiveServerIds()),
          getPuuidsBlockedFromLivePolling(tx),
          tx.bucksDareV2.findMany({
            where: { dareState: "active" },
            include: { targets: { orderBy: { id: "asc" } } },
          }),
        ]),
      { isolationLevel: "RepeatableRead" },
    );
  const requiredDarePuuids = await recoverUnavailableActiveDares({
    activeDares,
    accounts: allAccountsWithState,
    currentTime,
  });
  const accountsWithState = allAccountsWithState.filter(
    ({ config }) => !blockedPuuids.has(config.league.leagueAccount.puuid),
  );
  logger.info(
    `📊 Found ${accountsWithState.length.toString()} pollable player account(s); ${blockedPuuids.size.toString()} PUUID(s) are completing initial history import; ${requiredDarePuuids.size.toString()} active Dare account(s) are mandatory`,
  );

  const blockedRequiredPuuids = [...requiredDarePuuids].filter((puuid) =>
    blockedPuuids.has(puuid),
  );
  if (blockedRequiredPuuids.length > 0) {
    logger.warn(
      `Withholding match discovery while active Dare target account(s) finish initial history import: ${blockedRequiredPuuids.join(", ")}`,
    );
    return {
      complete: false,
      intents: [],
      allPlayerConfigs: accountsWithState.map((account) => account.config),
      evidenceWatermark: currentTime,
    };
  }
  const playersToCheck = selectMatchPollAccounts({
    accounts: accountsWithState,
    requiredPuuids: requiredDarePuuids,
    currentTime,
    ordinaryLimit: MAX_PLAYERS_PER_RUN,
  });
  logger.info(
    `📊 Checking ${playersToCheck.length.toString()} unique account(s) this run`,
  );
  const collected = await collectNewMatches({
    playersToCheck,
    currentTime,
    requiredDarePuuids,
  });
  if (!collected.complete) {
    return {
      complete: false,
      intents: [],
      allPlayerConfigs: accountsWithState.map((account) => account.config),
      evidenceWatermark: currentTime,
    };
  }
  const intents = deduplicateMatchIntents(collected.playersWithMatches);
  const ordered = await orderMatchIntentsByCompletion(
    intents,
    currentTime.getTime(),
    async (intent) => {
      const match = await fetchMatchData(
        MatchIdSchema.parse(intent.matchId),
        intent.region,
      );
      return match?.info.gameEndTimestamp;
    },
  );
  if (ordered.kind === "unavailable") {
    logger.warn(
      `Withholding match discovery because completion time is unavailable for ${ordered.matchId}`,
    );
    return {
      complete: false,
      intents: [],
      allPlayerConfigs: accountsWithState.map((account) => account.config),
      evidenceWatermark: currentTime,
    };
  }
  if (ordered.deferredMatchIds.length > 0) {
    logger.info(
      `Deferring ${ordered.deferredMatchIds.length.toString()} match(es) completed after the poll watermark: ${ordered.deferredMatchIds.join(", ")}`,
    );
  }
  return {
    complete: true,
    intents: ordered.intents,
    allPlayerConfigs: accountsWithState.map((account) => account.config),
    evidenceWatermark: currentTime,
  };
}

export async function discoverPostMatchIntents(): Promise<{
  matches: DiscoveredMatchIntent[];
  evidenceComplete: boolean;
  evidenceWatermark?: string;
}> {
  if (shouldSkipPollingRun()) {
    return { matches: [], evidenceComplete: false };
  }
  isPollingInProgress = true;
  pollingStartTime = Date.now();
  try {
    const discovery = await collectMatchDiscovery();
    if (!discovery.complete) {
      logger.warn(
        "Match discovery evidence is incomplete; maintenance may proceed without advancing ingestion cursors",
      );
      return { matches: [], evidenceComplete: false };
    }
    await setLastSuccessfulPollAt(new Date());
    return {
      matches: discovery.intents,
      evidenceComplete: true,
      evidenceWatermark: discovery.evidenceWatermark.toISOString(),
    };
  } finally {
    isPollingInProgress = false;
    pollingStartTime = undefined;
  }
}

/**
 * Main function to check for new matches via match history polling
 */
export async function checkMatchHistory(): Promise<{
  evidenceComplete: boolean;
  evidenceWatermark?: Date;
}> {
  // Prevent concurrent runs to avoid race conditions where two cron runs
  // could process the same match before lastProcessedMatchId is updated
  if (shouldSkipPollingRun()) {
    return { evidenceComplete: false };
  }

  isPollingInProgress = true;
  pollingStartTime = Date.now();
  logger.info("🔍 Starting match history polling check");
  const startTime = Date.now();

  try {
    const discovery = await collectMatchDiscovery();
    if (!discovery.complete) {
      logger.warn(
        "Match discovery evidence is incomplete; leaving ingestion cursors unchanged",
      );
      return { evidenceComplete: false };
    }
    if (discovery.intents.length === 0) {
      logger.info("✅ No new matches found for any players");
      const totalTime = Date.now() - startTime;
      logger.info(
        `⏱️  Match history check completed in ${totalTime.toString()}ms`,
      );
      await setLastSuccessfulPollAt(new Date());
      return {
        evidenceComplete: true,
        evidenceWatermark: discovery.evidenceWatermark,
      };
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
    return {
      evidenceComplete: true,
      evidenceWatermark: discovery.evidenceWatermark,
    };
  } catch (error) {
    logger.error("❌ Error in match history check:", error);
    throw error;
  } finally {
    isPollingInProgress = false;
    pollingStartTime = undefined;
  }
}
