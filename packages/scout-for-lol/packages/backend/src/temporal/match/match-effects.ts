import { settleDaresWithTimeline } from "#src/dares/evaluation/dare-postmatch-timeline.ts";
import { listDareIdsSettledByMatch } from "#src/dares/settlement/dare-settle.ts";
import { prisma } from "#src/database/index.ts";
import {
  MATCH_RECEIPT_KINDS,
  progressionEvidenceCodec,
  settlementEvidenceCodec,
} from "#src/durable/match/receipt-evidence.ts";
import { matchEffectsAllowed } from "#src/evidence/admission.ts";
import { createLogger } from "#src/logger.ts";
import { withChallengeProgressionLock } from "#src/progression/challenges/locking.ts";
import { processCompetitiveProgressionMatch } from "#src/progression/postmatch.ts";
import { runGuardedEffect } from "#src/temporal/effect-fence.ts";
import {
  readMatchReceiptEvidence,
  recordMatchReceipt,
} from "#src/temporal/match/match-commits.ts";
import { resolveScoutObservedMatchContext } from "#src/temporal/match/match-context.ts";
import {
  matchMayAnnounce,
  mintPostmatchIntents,
} from "#src/temporal/notification/match-intents.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type {
  ScoutGuardedEffectResult,
  ScoutMintedIntentsResult,
} from "@scout-for-lol/temporal/activity-contracts";
import { ApplicationFailure } from "@temporalio/common";
const logger = createLogger("scout-match-effects");

/** Resolve free Dares; the Activity adapter keeps its historical wire name. */
export async function settleMatchDares(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutGuardedEffectResult> {
  if (!(await matchEffectsAllowed(input.riotMatchId)))
    throw ApplicationFailure.nonRetryable(
      "Historical matches cannot resolve dares",
      "HistoryOnlyEffectDenied",
    );
  return await runGuardedEffect({
    key: "v2-match-settlement:" + input.riotMatchId,
    alreadyApplied: async () => {
      const standing = await readMatchReceiptEvidence(
        input.riotMatchId,
        MATCH_RECEIPT_KINDS.settlement,
      );
      return standing === null
        ? null
        : {
            fact: { outcome: "already-applied" },
            effects:
              settlementEvidenceCodec.parse(standing).resolvedDareIds.length,
          };
    },
    apply: async (fence) => {
      const context = await resolveScoutObservedMatchContext(input.riotMatchId);
      await fence.assertHeld();
      await settleDaresWithTimeline({
        matchData: context.matchData,
        matchDataSource: context.matchDataSource,
        trackedPlayers: context.trackedPlayers,
        prismaClient: prisma,
        notify: (await matchMayAnnounce(prisma, input.riotMatchId))
          ? "enqueue"
          : "withhold",
      });
      await fence.assertHeld();
      const resolvedDareIds = await listDareIdsSettledByMatch(
        input.riotMatchId,
        prisma,
      );
      return {
        fact: await recordMatchReceipt({
          matchId: input.riotMatchId,
          kind: MATCH_RECEIPT_KINDS.settlement,
          evidence: settlementEvidenceCodec.serialize({ resolvedDareIds }),
        }),
        effects: resolvedDareIds.length,
      };
    },
  });
}

export async function applyMatchProgression(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutGuardedEffectResult> {
  if (!(await matchEffectsAllowed(input.riotMatchId)))
    throw ApplicationFailure.nonRetryable(
      `Historical match ${input.riotMatchId} cannot apply progression`,
      "HistoryOnlyEffectDenied",
    );
  return await runGuardedEffect({
    key: `v2-match-progression:${input.riotMatchId}`,
    alreadyApplied: async () => {
      const standing = await readMatchReceiptEvidence(
        input.riotMatchId,
        MATCH_RECEIPT_KINDS.progression,
      );
      if (standing === null) return null;
      return {
        fact: { outcome: "already-applied" },
        effects: progressionEvidenceCodec.parse(standing).trackedAccountCount,
      };
    },
    apply: async (fence) => {
      // The OBSERVED roster. This stage is the one where a live rebuild does
      // lasting damage rather than transient: `trackedAccountCount` below is
      // written into the receipt, so a roster narrowed by this worker's gateway
      // cache would become durable evidence attesting the wrong number, and a
      // later reader has no way to tell it from the truth.
      const context = await resolveScoutObservedMatchContext(input.riotMatchId);
      const evidence = {
        participantCount: context.matchData.metadata.participants.length,
        trackedAccountCount: context.trackedPlayers.length,
      };
      await fence.assertHeld();
      await withChallengeProgressionLock(
        context.matchData.metadata.participants,
        async () => {
          await processCompetitiveProgressionMatch({
            match: context.matchData,
            matchDataSource: context.matchDataSource,
            timeline: undefined,
            trackedPlayers: context.trackedPlayers,
          });
        },
      );
      await fence.assertHeld();
      return {
        fact: await recordMatchReceipt({
          matchId: input.riotMatchId,
          kind: MATCH_RECEIPT_KINDS.progression,
          evidence: progressionEvidenceCodec.serialize(evidence),
        }),
        // The progression applier returns no identities, so the countable unit
        // is the one its receipt attests to: the tracked accounts this stage
        // advanced progression for.
        effects: evidence.trackedAccountCount,
      };
    },
  });
}

/**
 * Mint the visible post-match report's intents for this match.
 *
 * Its own Activity because the report is owed independently of Dare results
 * and needs only the match and its observed audience.
 *
 * Idempotent by read-before-write, so no receipt gates it: a resumed run finds
 * the rows its predecessor minted and writes nothing. A silent-backfill match
 * mints none, decided inside the minter from the committed observation.
 */
export async function mintPostmatchNotificationIntents(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutMintedIntentsResult> {
  // The audience is read from the SNAPSHOT the observation recorded, not
  // rebuilt from who is tracked now.
  //
  // The report is owed to the accounts this match was observed for, and that
  // set was settled at observation time. Rebuilding it here asks a different
  // question — who is tracked at the moment this Activity happens to run —
  // and an account deregistered in between answers it by vanishing: the mint
  // succeeds with fewer channels, the Workflow advances the cursor over a
  // complete-looking run, and a report that was owed is gone with nothing
  // recording that it was dropped.
  //
  // That window is not narrow. The Activity retries, and a takeover can run
  // it much later than the observation; `MatchTrackedAccount` exists to make
  // the answer durable rather than time-dependent, which is why the
  // observation writes it in the same call that commits.
  //
  // This reasoning was always right and was for a long time written only here.
  // The resolver now carries it, so the render — which had rebuilt the roster
  // and failed on the empty result — agrees with it instead of contradicting
  // it, and the PUUID set is derived once rather than beside the payload read.
  const context = await resolveScoutObservedMatchContext(input.riotMatchId);
  const summary = await mintPostmatchIntents(prisma, {
    matchId: input.riotMatchId,
    puuids: context.observedPuuids,
    queue: {
      queueId: context.matchData.info.queueId,
      gameMode: context.matchData.info.gameMode,
      gameType: context.matchData.info.gameType,
    },
    gameCreation: context.matchData.info.gameCreation,
    createdAt: new Date(),
  });
  logger.info(
    `🔔 Post-match report intents for ${input.riotMatchId}: ${String(summary.minted)} minted, ${String(summary.existing)} already standing, ${String(summary.silent)} withheld as silent-backfill`,
  );
  return {
    minted: summary.minted,
    existing: summary.existing,
    conflicts: summary.conflicts,
    silent: summary.silent,
  };
}
