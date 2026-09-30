import * as Sentry from "@sentry/bun";
import type { ProcessMatchUpdateOptions } from "#src/league/tasks/postmatch/match-processing.ts";
import { deliverPostmatchReport } from "#src/league/tasks/postmatch/match-report-delivery.ts";
import { createLogger } from "#src/logger.ts";
import { recordMatchForReportStore } from "#src/report-store/live-ingest.ts";
import {
  claimScoutEffect,
  completeScoutEffect,
  recordScoutEffectFailure,
} from "#src/temporal/effect-claims.ts";
import { liveDurableFacts } from "#src/durable/match/live-facts.ts";
import {
  recordObservedMatch,
  requestMatchArchive,
} from "#src/durable/match/archive-facts.ts";

const logger = createLogger("postmatch-match-history-polling");

type TrackedPlayer = ProcessMatchUpdateOptions["allPlayerConfigs"][number];

export async function persistAuthoritativeMatch(input: {
  matchData: ProcessMatchUpdateOptions["matchData"];
  matchId: string;
  trackedPlayers: TrackedPlayer[];
  silent: boolean;
}): Promise<void> {
  const effectKey = `raw-match-s3:${input.matchId}`;
  const source = input.silent ? "postmatch_silent_backfill" : "postmatch_live";
  const observed = {
    matchId: input.matchId,
    gameCreation: input.matchData.info.gameCreation,
    trackedPuuids: input.trackedPlayers.map(
      (player) => player.league.leagueAccount.puuid,
    ),
    source,
  };
  let claimed = false;
  try {
    const claim = await claimScoutEffect({
      key: effectKey,
      kind: "raw-match-s3",
    });
    if (claim !== "execute") {
      // An earlier run already archived this match, so there is no fresh
      // archive outcome to attest to — but the match and its tracked accounts
      // are still facts, and the cursor advance ahead needs their rows.
      await recordObservedMatch({ facts: liveDurableFacts(), match: observed });
      return;
    }
    claimed = true;
    // The durable observation and its archive receipts are written only after
    // the whole gate below has passed, so an observation row always means the
    // raw payload really did become canonical.
    await requestMatchArchive({
      facts: liveDurableFacts(),
      match: observed,
      archive: async () => {
        const ingest = await recordMatchForReportStore({
          match: input.matchData,
          source,
          trackedPlayerAliases: input.trackedPlayers.map(
            (player) => player.alias,
          ),
        });
        if (!ingest.staged) {
          throw new Error(
            `Report lake staging failed for ${input.matchId}; cursor advancement is blocked.`,
          );
        }
        await completeScoutEffect(effectKey);
        return ingest;
      },
    });
  } catch (error) {
    if (claimed) await recordScoutEffectFailure(effectKey, error);
    logger.error(
      `[processMatch] ❌ Authoritative S3 ingest failed for ${input.matchId} — NOT advancing cursor; will retry next poll`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "report-store-ingest-gate", matchId: input.matchId },
    });
    throw error;
  }
}

export async function deliverVisiblePostmatchReport(input: {
  silent: boolean;
  matchId: string;
  matchData: ProcessMatchUpdateOptions["matchData"];
  trackedPlayers: TrackedPlayer[];
  prefetchedTimeline: Parameters<
    typeof deliverPostmatchReport
  >[0]["prefetchedTimeline"];
  prefetchedPlayers: Parameters<
    typeof deliverPostmatchReport
  >[0]["prefetchedPlayers"];
  prefetchedRankChanges: Parameters<
    typeof deliverPostmatchReport
  >[0]["prefetchedRankChanges"];
}): Promise<ReadonlyMap<string, string>> {
  if (input.silent) return new Map();
  try {
    return await deliverPostmatchReport({
      matchData: input.matchData,
      trackedPlayers: input.trackedPlayers,
      ...(input.prefetchedTimeline === undefined
        ? {}
        : { prefetchedTimeline: input.prefetchedTimeline }),
      ...(input.prefetchedPlayers === undefined
        ? {}
        : { prefetchedPlayers: input.prefetchedPlayers }),
      ...(input.prefetchedRankChanges === undefined
        ? {}
        : { prefetchedRankChanges: input.prefetchedRankChanges }),
    });
  } catch (error) {
    logger.error(
      `[processMatch] ❌ processMatch threw for ${input.matchId} — cursor will still advance (durable S3 copy already saved)`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "process-match-throw", matchId: input.matchId },
    });
    return new Map();
  }
}
