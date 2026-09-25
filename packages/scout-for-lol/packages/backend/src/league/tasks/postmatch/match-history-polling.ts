import type { MatchId } from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import { getAccountsWithState } from "#src/database/player-accounts.ts";
import { updateLastProcessedMatch } from "#src/database/account-cursors.ts";
import { MatchIdSchema } from "@scout-for-lol/data/index.ts";
import { getActiveServerIds } from "#src/discord/utils/guild-membership.ts";
import { MAX_PLAYERS_PER_RUN } from "@scout-for-lol/data/polling-config.ts";
import {
  processMatchForPlayer,
  type ProcessMatchUpdateOptions,
} from "#src/league/tasks/postmatch/match-processing.ts";
import { createLogger } from "#src/logger.ts";
import { announceSettlements } from "#src/betting/notify/announce.ts";
import { deliverDareSummaries } from "#src/betting/dares/presentation/notify/dare-delivery.ts";
import {
  voidDareV2WithFullRefund,
  type RefundableDareV2Row,
} from "#src/betting/dares/settlement/dare-void-v2.ts";
import type { settleAndAwardBucks } from "#src/betting/markets/postmatch-hook.ts";
import { settleBucksWithDareTimelineV2 } from "#src/betting/dares/evaluation/dare-postmatch-timeline-v2.ts";
import { matchHistoryPollingSkipsTotal } from "#src/metrics/index.ts";
import {
  markPostMatchPollCompleted,
  markPostMatchPollFailed,
} from "#src/league/tasks/recovery/app-state.ts";
import {
  beginPollingRun,
  endPollingRun,
  openPostMatchPoll,
  type PostMatchPollOwnership,
} from "#src/league/tasks/postmatch/poll-ownership.ts";
import type { PostMatchPollOwner } from "#src/league/tasks/recovery/app-state.ts";
import { getPostmatchMessageIdsForMatchIdOrEmpty } from "#src/league/tasks/prematch/active-game-queries.ts";
import { getPuuidsBlockedFromLivePolling } from "#src/league/initial-history/live-polling.ts";
import {
  deduplicateMatchIntents,
  orderMatchIntentsByCompletion,
  type DiscoveredMatchIntent,
  type MatchDiscovery,
} from "#src/league/tasks/postmatch/match-intents.ts";
import { finalizeAndPublishManagedCustomResult } from "#src/customs/riot-result-publication.ts";
import { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import {
  deliverVisiblePostmatchReport,
  persistAuthoritativeMatch,
} from "#src/league/tasks/postmatch/match-history-polling-effects.ts";
import { collectNewMatches } from "#src/league/tasks/postmatch/match-history-collection.ts";
import {
  activeDareTargetPuuids,
  selectMatchPollAccounts,
  unavailableRequiredPuuids,
  type MatchPollAccount,
} from "#src/league/tasks/postmatch/match-discovery-selection.ts";
import { withChallengeProgressionLock } from "#src/progression/challenges/locking.ts";
import { liveDurableFacts } from "#src/durable/match/live-facts.ts";
import { commitMatchSettlement } from "#src/durable/match/settlement-facts.ts";
import {
  recordCursorAdvanced,
  runMatchProgressionStage,
} from "#src/durable/match/progression-facts.ts";
import { settlementEvidenceOf } from "#src/league/tasks/postmatch/settlement-evidence.ts";

const logger = createLogger("postmatch-match-history-polling");

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
  await persistAuthoritativeMatch({
    matchData,
    matchId,
    trackedPlayers: allTrackedPlayers,
    silent,
  });

  // The durable recorder for this match's facts. v1 stays authoritative for
  // every decision below; each recorded fact is fail-open behind its own
  // boundary, so a recorder outage cannot stall ingestion.
  const facts = liveDurableFacts();

  // After the S3 gate and OUTSIDE `!silent`: Bucks are owed for the game even
  // when the ordinary match report is suppressed. See settleAndAwardBucks.
  const {
    bucks,
    prefetchedTimeline,
    prefetchedPlayers,
    prefetchedRankChanges,
  } = await commitMatchSettlement({
    facts,
    matchId,
    settle: async () =>
      await settleBucksWithDareTimelineV2({
        matchData,
        matchDataSource: "RIOT",
        trackedPlayers: allTrackedPlayers,
        prismaClient: prisma,
      }),
    evidence: (settled) => settlementEvidenceOf(settled.bucks),
  });
  let postmatchMessageIds = await deliverVisiblePostmatchReport({
    silent,
    matchId,
    matchData,
    trackedPlayers: allTrackedPlayers,
    prefetchedTimeline,
    prefetchedPlayers,
    prefetchedRankChanges,
  });

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
  await finalizeAndPublishManagedCustomResult(prisma, matchData, "RIOT");

  const { processCompetitiveProgressionMatch } =
    await import("#src/progression/postmatch.ts");
  await withChallengeProgressionLock(
    matchData.metadata.participants,
    async () => {
      await runMatchProgressionStage({
        facts,
        matchId,
        evidence: {
          participantCount: matchData.metadata.participants.length,
          trackedAccountCount: allTrackedPlayers.length,
        },
        advance: async () => {
          await processCompetitiveProgressionMatch({
            match: matchData,
            matchDataSource: "RIOT",
            timeline: prefetchedTimeline,
            trackedPlayers: allTrackedPlayers,
          });
        },
      });

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
        await recordCursorAdvanced({ facts, matchId, puuid: playerPuuid });
      }
    },
  );
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
      await voidDareV2WithFullRefund(dare, "target_unavailable", prisma, {
        now: input.currentTime,
      });
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

/**
 * Whether a discovery pass ran at all.
 *
 * `skipped` means another poll was still in progress and this call refused to
 * open a second one: it opened nothing and owns no `BotState.pollStatus` to
 * close. A caller that runs post-match maintenance on that answer marks the
 * OTHER poll complete under it. `polled` covers every pass that opened a poll,
 * complete or not — an incomplete pass still owes the maintenance that closes
 * what it opened.
 */
export type PostMatchDiscoveryOutcome = "polled" | "skipped";

export async function discoverPostMatchIntents(options?: {
  ownership?: PostMatchPollOwnership;
  /**
   * The instant this pass claims the poll at, when the caller has one that is
   * stable across its own retries. Defaults to now.
   */
  startedAt?: Date;
}): Promise<{
  outcome: PostMatchDiscoveryOutcome;
  matches: DiscoveredMatchIntent[];
  evidenceComplete: boolean;
  evidenceWatermark?: string;
  /**
   * The claim this pass holds, under `durable` ownership only. The caller owes
   * the close that releases it, presenting this identity.
   */
  pollOwner?: PostMatchPollOwner;
}> {
  const startedAt = options?.startedAt ?? new Date();
  if (!beginPollingRun(startedAt)) {
    return { outcome: "skipped", matches: [], evidenceComplete: false };
  }
  try {
    const opened = await openPostMatchPoll(
      options?.ownership ?? "process",
      startedAt,
    );
    if (opened.outcome === "held") {
      logger.info(
        `⏸️  A post-match poll claimed at ${opened.since?.toISOString() ?? "an unknown time"} still holds the poll; skipping this run`,
      );
      matchHistoryPollingSkipsTotal.inc({ reason: "poll_claim_held" });
      return { outcome: "skipped", matches: [], evidenceComplete: false };
    }
    const owner = opened.owner;
    const held = owner === undefined ? {} : { pollOwner: owner };
    const close = owner === undefined ? {} : { owner };
    try {
      const discovery = await collectMatchDiscovery();
      if (!discovery.complete) {
        logger.warn(
          "Match discovery evidence is incomplete; maintenance may proceed without advancing ingestion cursors",
        );
        return {
          outcome: "polled",
          matches: [],
          evidenceComplete: false,
          ...held,
        };
      }
      return {
        outcome: "polled",
        matches: discovery.intents,
        evidenceComplete: true,
        evidenceWatermark: discovery.evidenceWatermark.toISOString(),
        ...held,
      };
    } catch (error) {
      // Closed as failed by whoever opened it: v1 overwrites whatever stands,
      // and a durable claimant closes only its own poll. Either way the poll
      // is released here rather than left standing for a caller that will
      // never reach maintenance, because this pass is throwing past it.
      await markPostMatchPollFailed(error, new Date(), close);
      throw error;
    }
  } finally {
    endPollingRun();
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
  const pollStartedAt = new Date();
  if (!beginPollingRun(pollStartedAt)) {
    return { evidenceComplete: false };
  }

  logger.info("🔍 Starting match history polling check");
  const startTime = Date.now();

  try {
    await openPostMatchPoll("process", pollStartedAt);
    const discovery = await collectMatchDiscovery();
    if (!discovery.complete) {
      logger.warn(
        "Match discovery evidence is incomplete; leaving ingestion cursors unchanged",
      );
      await markPostMatchPollCompleted({
        completedAt: new Date(),
        evidenceComplete: false,
        evidenceWatermark: discovery.evidenceWatermark,
      });
      return { evidenceComplete: false };
    }
    if (discovery.intents.length === 0) {
      logger.info("✅ No new matches found for any players");
      const totalTime = Date.now() - startTime;
      logger.info(
        `⏱️  Match history check completed in ${totalTime.toString()}ms`,
      );
      await markPostMatchPollCompleted({
        completedAt: new Date(),
        evidenceComplete: true,
        evidenceWatermark: discovery.evidenceWatermark,
      });
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

    await markPostMatchPollCompleted({
      completedAt: new Date(),
      evidenceComplete: true,
      evidenceWatermark: discovery.evidenceWatermark,
    });
    return {
      evidenceComplete: true,
      evidenceWatermark: discovery.evidenceWatermark,
    };
  } catch (error) {
    logger.error("❌ Error in match history check:", error);
    await markPostMatchPollFailed(error, new Date());
    throw error;
  } finally {
    endPollingRun();
  }
}
