import { prisma } from "#src/database/index.ts";
import { getAccountsWithState } from "#src/database/player-accounts.ts";
import { MatchIdSchema } from "@scout-for-lol/data/index.ts";
import { getActiveServerIds } from "#src/discord/utils/guild-membership.ts";
import { MAX_PLAYERS_PER_RUN } from "@scout-for-lol/data/polling-config.ts";
import { createLogger } from "#src/logger.ts";
import {
  voidDareWithFullRefund,
  type RefundableDareRow,
} from "#src/betting/dares/settlement/dare-void.ts";
import { matchHistoryPollingSkipsTotal } from "#src/metrics/index.ts";
import {
  markPostMatchPollFailed,
  type PostMatchPollOwner,
} from "#src/league/tasks/recovery/app-state.ts";
import {
  beginPollingRun,
  endPollingRun,
  openPostMatchPoll,
} from "#src/league/tasks/postmatch/poll-ownership.ts";
import { getPuuidsBlockedFromLivePolling } from "#src/league/initial-history/live-polling.ts";
import {
  deduplicateMatchIntents,
  orderMatchIntentsByCompletion,
  type DiscoveredMatchIntent,
  type MatchDiscovery,
} from "#src/league/tasks/postmatch/match-intents.ts";
import { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { collectNewMatches } from "#src/league/tasks/postmatch/match-history-collection.ts";
import {
  activeDareTargetPuuids,
  selectMatchPollAccounts,
  unavailableRequiredPuuids,
  type MatchPollAccount,
} from "#src/league/tasks/postmatch/match-discovery-selection.ts";

const logger = createLogger("postmatch-match-history-polling");

async function recoverUnavailableActiveDares(input: {
  activeDares: readonly RefundableDareRow[];
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
      await voidDareWithFullRefund(dare, "target_unavailable", prisma, {
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
          tx.bucksDare.findMany({
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
  /**
   * The instant this pass claims the poll at, when the caller has one that is
   * stable across its own retries. Defaults to now.
   */
  startedAt?: Date;
}): Promise<
  | { outcome: Extract<PostMatchDiscoveryOutcome, "skipped"> }
  | {
      outcome: Extract<PostMatchDiscoveryOutcome, "polled">;
      matches: DiscoveredMatchIntent[];
      evidenceComplete: boolean;
      evidenceWatermark?: string;
      /**
       * The claim this pass holds. The caller owes the close that releases
       * it, presenting this identity.
       */
      pollOwner: PostMatchPollOwner;
    }
> {
  const startedAt = options?.startedAt ?? new Date();
  if (!beginPollingRun(startedAt)) {
    return { outcome: "skipped" };
  }
  try {
    const opened = await openPostMatchPoll(startedAt);
    if (opened.outcome === "held") {
      logger.info(
        `⏸️  A post-match poll claimed at ${opened.since?.toISOString() ?? "an unknown time"} still holds the poll; skipping this run`,
      );
      matchHistoryPollingSkipsTotal.inc({ reason: "poll_claim_held" });
      return { outcome: "skipped" };
    }
    const owner = opened.owner;
    const held = { pollOwner: owner };
    const close = { owner };
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
      // Closed as failed under this pass's own claim, rather than left
      // standing for a caller that will never reach maintenance, because this
      // pass is throwing past it.
      await markPostMatchPollFailed(error, new Date(), close);
      throw error;
    }
  } finally {
    endPollingRun();
  }
}
