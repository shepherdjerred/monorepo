import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutGuardedEffectV2Result } from "@scout-for-lol/temporal/activity-contracts-v2";
import type { ScoutDurableCommitV2 } from "@scout-for-lol/temporal/contracts-v2";
import { settleBucksWithDareTimelineV2 } from "#src/betting/dares/evaluation/dare-postmatch-timeline-v2.ts";
import { prisma } from "#src/database/index.ts";
import {
  MATCH_RECEIPT_KINDS,
  progressionEvidenceCodec,
  settlementEvidenceCodec,
  type SettlementEvidence,
} from "#src/durable/match/receipt-evidence.ts";
import { settlementEvidenceOf } from "#src/league/tasks/postmatch/settlement-evidence.ts";
import { withChallengeProgressionLock } from "#src/progression/challenges/locking.ts";
import { processCompetitiveProgressionMatch } from "#src/progression/postmatch.ts";
import {
  claimScoutEffect,
  completeScoutEffect,
  getScoutEffectClaim,
  recordScoutEffectFailure,
} from "#src/temporal/effect-claims.ts";
import { recordMatchReceiptV2 } from "#src/temporal/v2/match-commits.ts";
import { resolveScoutV2MatchContext } from "#src/temporal/v2/match-context.ts";

/**
 * The two at-most-once effects of the per-match core.
 *
 * Both are guarded by a `ScoutEffectClaim` and both report the guard and the
 * durable fact as SEPARATE outcomes, because they are separate commits: the
 * claim cannot enlist in the transaction that writes the fact (see
 * `effect-claims.ts` for why that is a property of the claim's protocol rather
 * than of its type). A run that claimed and died before the fact comes back to
 * `guard: already-applied` with `fact: applied`, and that reconcile has to be
 * reportable rather than indistinguishable from a double application.
 *
 * The claim keys are V2's own. Sharing v1's would be wrong in both directions:
 * v1 does not claim settlement or progression at all, and a shared key would
 * make one pipeline's completion silently suppress the other's work. Ownership
 * — not the claim — is what keeps the two pipelines off the same match, and
 * `commitMatchObservationV2` is where that is decided.
 */

type GuardedEffect = {
  readonly fact: ScoutDurableCommitV2;
  readonly effects: number;
};

/**
 * Run one guarded effect and report the guard and the fact apart.
 *
 * The claim is READ before it is made. `claimScoutEffect` answers what the
 * caller may do, which collapses a first claim and a retry of an unfinished
 * one into `execute`; the prior read is what separates `applied` from
 * `already-applied` on the guard.
 *
 * `completeScoutEffect` runs after the fact commits, so a crash between them
 * leaves the claim unfinished and the next attempt re-applies. Both effects
 * below are state-gated in their own tables — settlement reads pending bets
 * and unresolved Dares, progression re-prepares from current runs — so the
 * repeat finds nothing left to do and the fact comes back `already-applied`.
 */
async function runGuardedEffectV2(args: {
  key: string;
  kind: string;
  apply: () => Promise<GuardedEffect>;
}): Promise<ScoutGuardedEffectV2Result> {
  const prior = await getScoutEffectClaim(args.key);
  const claim = await claimScoutEffect({ key: args.key, kind: args.kind });
  const guard: ScoutDurableCommitV2 =
    prior === null ? { outcome: "applied" } : { outcome: "already-applied" };
  if (claim === "completed") {
    return { guard, fact: { outcome: "already-applied" }, effects: 0 };
  }
  try {
    const applied = await args.apply();
    await completeScoutEffect(args.key);
    return { guard, fact: applied.fact, effects: applied.effects };
  } catch (error) {
    await recordScoutEffectFailure(args.key, error);
    throw error;
  }
}

/** How many ledger rows one settlement moved, by the identities it names. */
function settledRecordCount(evidence: SettlementEvidence): number {
  return (
    evidence.closedBetIds.length +
    evidence.settledBetIds.length +
    evidence.resolvedDareIds.length +
    evidence.settledParlayGuildIds.length +
    evidence.earnedDiscordIds.length
  );
}

/**
 * Close and settle this match's markets, parlays, Dares and awards.
 *
 * One commit, one receipt: v1 settles all of them in a single call before
 * anything is announced, and the receipt covers that whole commit while its
 * evidence keeps the identities apart — a Dare resolution and a market
 * settlement are different products and must not collapse into one number.
 *
 * Announcement is NOT part of this Activity. v1 announces inline because it
 * has no other place to; V2 mints notification intents and starts
 * `scoutNotificationV2Workflow` children after the domain commit stands, so a
 * settlement that committed can never have already told a user about a fact
 * the pipeline then failed to make durable.
 */
export async function settleMatchMarketsV2(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutGuardedEffectV2Result> {
  return await runGuardedEffectV2({
    key: `v2-match-settlement:${input.riotMatchId}`,
    kind: "v2-match-settlement",
    apply: async () => {
      // Resolved inside the guard so a replay whose claim is already complete
      // costs no Riot read at all.
      const context = await resolveScoutV2MatchContext(input.riotMatchId);
      const settled = await settleBucksWithDareTimelineV2({
        matchData: context.matchData,
        trackedPlayers: context.trackedPlayers,
        prismaClient: prisma,
      });
      const evidence = settlementEvidenceOf(settled.bucks);
      return {
        fact: await recordMatchReceiptV2({
          matchId: input.riotMatchId,
          kind: MATCH_RECEIPT_KINDS.settlement,
          evidence: settlementEvidenceCodec.serialize(evidence),
        }),
        effects: settledRecordCount(evidence),
      };
    },
  });
}

/**
 * Advance competitive progression for this match under the advisory lock.
 *
 * The lock protocol is v1's, unchanged: one `pg_advisory_xact_lock` per
 * participant PUUID and per affected challenge run, taken in sorted order
 * inside one interactive transaction, released when that transaction ends.
 * Sorting is what prevents two matches sharing a player from deadlocking each
 * other, and the lock is what stops two runs recomputing the same challenge
 * run from interleaving.
 *
 * No timeline is prefetched. v1 passes the one its settlement step happened to
 * fetch; a V2 Activity has no such value to inherit, and `undefined` is the
 * honest answer — `processCompetitiveProgressionMatch` already fetches a
 * timeline itself for exactly the revisions that require one, so passing
 * `null` instead would assert there is none.
 */
export async function applyMatchProgressionV2(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutGuardedEffectV2Result> {
  return await runGuardedEffectV2({
    key: `v2-match-progression:${input.riotMatchId}`,
    kind: "v2-match-progression",
    apply: async () => {
      const context = await resolveScoutV2MatchContext(input.riotMatchId);
      const evidence = {
        participantCount: context.matchData.metadata.participants.length,
        trackedAccountCount: context.trackedPlayers.length,
      };
      await withChallengeProgressionLock(
        context.matchData.metadata.participants,
        async () => {
          await processCompetitiveProgressionMatch({
            match: context.matchData,
            timeline: undefined,
            trackedPlayers: context.trackedPlayers,
          });
        },
      );
      return {
        fact: await recordMatchReceiptV2({
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
