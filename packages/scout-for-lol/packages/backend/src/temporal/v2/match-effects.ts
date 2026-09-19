import { ApplicationFailure } from "@temporalio/common";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type {
  ScoutGuardedEffectV2Result,
  ScoutMintedIntentsV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
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
  announcingSettlementSink,
  silentSettlementSink,
  type SettlementAnnouncementSink,
} from "#src/betting/notify/announcement-sink.ts";
import { runGuardedEffectV2 } from "#src/temporal/v2/effect-fence.ts";
import { durableCommitV2 } from "#src/temporal/v2/match-commits.ts";
import {
  readMatchReceiptEvidenceV2,
  recordMatchReceiptV2,
} from "#src/temporal/v2/match-commits.ts";
import { resolveScoutV2MatchContext } from "#src/temporal/v2/match-context.ts";
import {
  matchMayAnnounce,
  mintDareSummaryIntentsV2,
  mintPostmatchIntentsV2,
  mintSettlementIntentsV2,
  recoveredAnnouncementsOf,
  settlementAnnouncementItemsOf,
} from "#src/temporal/v2/notification/match-intents.ts";
import {
  listSettlementAnnouncementItems,
  recordSettlementAnnouncementItem,
  type SettlementAnnouncementItem,
} from "#src/database/durable/settlement-announcement-repository.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("scout-v2-match-effects");

/**
 * The two at-most-once effects of the per-match core.
 *
 * Both run behind the fence in `effect-fence.ts`, which is what makes them
 * at-most-once under Temporal: the claim row alone lets a retry enter while
 * the original attempt is still running, and an advisory lock held across the
 * effect is what stops two live attempts.
 *
 * Both report the guard and the durable fact as SEPARATE outcomes, because
 * they are separate commits: the claim cannot enlist in the transaction that
 * writes the fact (see `effect-claims.ts` for why that is a property of the
 * claim's protocol rather than of its type). A run that claimed and died
 * before the fact comes back to `guard: already-applied` with
 * `fact: applied`, and that reconcile has to be reportable rather than
 * indistinguishable from a double application.
 *
 * The claim keys are V2's own. Sharing v1's would be wrong in both directions:
 * v1 does not claim settlement or progression at all, and a shared key would
 * make one pipeline's completion silently suppress the other's work. Ownership
 * — not the claim — is what keeps the two pipelines off the same match, and
 * `commitMatchObservationV2` is where that is decided.
 *
 * ## The write boundaries each effect owns
 *
 * Both effects call `fence.assertHeld()` at exactly two points: before they
 * enter their domain commit, and before they record the fact that attests to
 * it. Those are the durable writes V2 owns on these paths; between them runs
 * v1 code — settlement's ledger writes, progression's writes under its own
 * advisory lock — that takes no signal, and a check on either side of it is
 * what keeps a zombie attempt from entering a commit after its fence lapsed,
 * or attesting to one afterwards. See `effect-fence.ts` for the discipline
 * and for the residual it leaves.
 */

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
/**
 * V2's sink for a match that MAY announce.
 *
 * Announcing is deferred rather than immediate: V2 mints intents after the
 * domain commit, so this sink sends nothing itself. What it does is record,
 * inside each producing transaction, the instruction to announce that item —
 * which is the only way a takeover can announce results a re-run would no
 * longer produce.
 *
 * It keeps v1's direct-delivery behaviours OFF for V2, because a V2 match that
 * delivered here would announce twice: once from the settlement call stack and
 * once from the intent the mint creates.
 */
function checkpointingSettlementSink(
  riotMatchId: RiotMatchId,
): SettlementAnnouncementSink {
  return {
    ...silentSettlementSink,
    // A live V2 match may still post a callout for a Dare that has none: that
    // is v1's own pre-existing surface and the gate's promise permits it for a
    // match a live discovery surfaced.
    mayPostDareCallout: announcingSettlementSink.mayPostDareCallout,
    recordAnnouncementItem: async (db, item) => {
      const commit = durableCommitV2(
        await recordSettlementAnnouncementItem(db, {
          matchId: riotMatchId,
          item,
        }),
      );
      if (commit.outcome !== "conflict") return;
      throw ApplicationFailure.nonRetryable(
        `A settlement announcement already stands for ${riotMatchId} (${item.family}/${item.itemKey}) with different instructions (${commit.reason}); refusing to overwrite the only record of what that transition produced`,
        "DurableCommitConflict",
      );
    },
  };
}

/**
 * Mint both announcement families from the instructions one settlement
 * produced, as one transaction.
 *
 * Shared by the attempt that settled and by the takeover recovering from its
 * checkpoint, so both mint from exactly the same instructions and the recovery
 * path cannot drift from the live one. All-or-nothing, so a failure can never
 * leave a subset nobody can identify as incomplete; read-gated inside, so the
 * takeover re-presenting instructions already minted writes nothing.
 *
 * A sibling transaction of the fence's, not a nested one: the fence holds its
 * advisory lock on its own connection and `apply` has always written through
 * the ambient client.
 */
async function mintFromInstructions(
  riotMatchId: RiotMatchId,
  items: readonly SettlementAnnouncementItem[],
  gameCreation: number,
): Promise<void> {
  const recovered = recoveredAnnouncementsOf(items);
  const createdAt = new Date();
  const { announced, dareSummaries } = await prisma.$transaction(
    async (tx) => ({
      announced: await mintSettlementIntentsV2(tx, {
        matchId: riotMatchId,
        announcements: recovered.settlements,
        gameCreation,
        createdAt,
      }),
      dareSummaries: await mintDareSummaryIntentsV2(tx, {
        matchId: riotMatchId,
        dareSettlements: recovered.dareSummaries,
        gameCreation,
        createdAt,
      }),
    }),
  );
  logger.info(
    `🔔 Settlement notifications for ${riotMatchId}: ${String(announced.minted)} recap(s) and ${String(dareSummaries.minted)} Dare summary(ies) minted, ${String(announced.silent + dareSummaries.silent)} withheld as silent-backfill, ${String(announced.undeliverable)} undeliverable`,
  );
}

export async function settleMatchMarketsV2(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutGuardedEffectV2Result> {
  return await runGuardedEffectV2({
    key: `v2-match-settlement:${input.riotMatchId}`,
    kind: "v2-match-settlement",
    // The settlement receipt IS this effect's durable fact, and its evidence
    // names every ledger row the commit moved — so a takeover can report what
    // the dead attempt did instead of re-settling a match whose bets are all
    // already resolved.
    alreadyApplied: async () => {
      const standing = await readMatchReceiptEvidenceV2(
        input.riotMatchId,
        MATCH_RECEIPT_KINDS.settlement,
      );
      if (standing === null) return null;
      return {
        fact: { outcome: "already-applied" },
        effects: settledRecordCount(settlementEvidenceCodec.parse(standing)),
      };
    },
    apply: async (fence) => {
      // Resolved inside the guard so a replay whose claim is already complete
      // costs no Riot read at all.
      const context = await resolveScoutV2MatchContext(input.riotMatchId);
      // A standing checkpoint means a previous attempt settled this match and
      // died before its receipt. Settlement's steps are one-shot, so re-running
      // it would return nothing and the announcements would be unmintable
      // forever; the checkpoint is what that attempt left so this one can mint
      // from what actually happened. Read before settling, because settling
      // again is the thing it exists to prevent.
      const recovered = await listSettlementAnnouncementItems(prisma, {
        matchId: input.riotMatchId,
      });
      if (recovered.length > 0) {
        await fence.assertHeld();
        await mintFromInstructions(
          input.riotMatchId,
          recovered,
          context.matchData.info.gameCreation,
        );
        await fence.assertHeld();
        const standing = await readMatchReceiptEvidenceV2(
          input.riotMatchId,
          MATCH_RECEIPT_KINDS.settlement,
        );
        const evidence =
          standing === null ? null : settlementEvidenceCodec.parse(standing);
        return {
          fact: { outcome: "already-applied" },
          effects: evidence === null ? 0 : settledRecordCount(evidence),
        };
      }
      // The Riot read above can take as long as Riot takes; the fence may
      // have lapsed while it ran, and the ledger must not be entered on a
      // lock this attempt no longer holds.
      await fence.assertHeld();
      // The sink decides whether anything this settlement produces may be
      // announced, and it is built from the COMMITTED delivery mode rather
      // than from anything this run was handed. A backfilled match settles in
      // full and announces nothing: no summaries delivered from the partial
      // path, no Dare DMs drained from the outbox, no callout posted.
      const settled = await settleBucksWithDareTimelineV2({
        matchData: context.matchData,
        trackedPlayers: context.trackedPlayers,
        prismaClient: prisma,
        announcementSink: (await matchMayAnnounce(prisma, input.riotMatchId))
          ? checkpointingSettlementSink(input.riotMatchId)
          : silentSettlementSink,
      });
      const evidence = settlementEvidenceOf(settled.bucks);
      // The checkpoint, written before anything else this attempt does with
      // the settlement's output. It is the only durable record of results no
      // retry can reproduce, so it goes down first and never changes: a
      // standing row whose instructions DIFFER is two producers disagreeing
      // about what one settlement produced, and that fails the Activity rather
      // than overwriting what the first one recorded.
      await fence.assertHeld();
      const instructions = settlementAnnouncementItemsOf({
        closures: settled.bucks.closures,
        settlements: settled.bucks.settlements,
        parlaySettlements: settled.bucks.parlaySettlements,
        earnings: settled.bucks.earnings,
        dareSettlements: settled.bucks.dareSettlements,
      });
      for (const item of instructions) {
        const checkpoint = durableCommitV2(
          await recordSettlementAnnouncementItem(prisma, {
            matchId: input.riotMatchId,
            item,
          }),
        );
        if (checkpoint.outcome === "conflict") {
          throw ApplicationFailure.nonRetryable(
            `A settlement announcement already stands for ${input.riotMatchId} (${item.family}/${item.itemKey}) with different instructions (${checkpoint.reason}); refusing to overwrite the only record of what that transition produced`,
            "DurableCommitConflict",
          );
        }
      }
      // Minted INSIDE the fence and before the receipt, because these intents
      // carry the summaries this settlement just produced and nothing else can
      // reconstruct them. A silent-backfill match mints none of them; that gate
      // lives in the minter, which reads the committed delivery mode rather
      // than trusting a caller. Ordering matters: the receipt is what a resumed
      // run reads to decide the effect is done, so an intent minted after it
      // could be lost by a crash the receipt says nothing remains for.
      await fence.assertHeld();
      // ONE transaction for both families, so the mint is all-or-nothing.
      //
      // Settlement's own output is one-shot — each of its steps returns
      // summaries only for the transition that committed them — so a partial
      // mint could never be completed by a retry: the re-run settles nothing
      // and returns nothing, and whichever announcements were missed would be
      // lost with no trace. All-or-nothing does not make that window
      // disappear, but it removes the case where the surviving evidence is a
      // SUBSET nobody can identify as incomplete.
      //
      // A sibling transaction of the fence's, not a nested one: the fence
      // holds the advisory lock on its own connection and `apply` has always
      // written through the ambient client, so this opens beside it rather
      // than inside it.
      await mintFromInstructions(
        input.riotMatchId,
        instructions,
        context.matchData.info.gameCreation,
      );
      await fence.assertHeld();
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
    alreadyApplied: async () => {
      const standing = await readMatchReceiptEvidenceV2(
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
      const context = await resolveScoutV2MatchContext(input.riotMatchId);
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
            timeline: undefined,
            trackedPlayers: context.trackedPlayers,
          });
        },
      );
      await fence.assertHeld();
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

/**
 * Mint the visible post-match report's intents for this match.
 *
 * Its own Activity rather than part of the settlement effect, because the
 * report is owed whatever settlement did — a match with no pool still gets a
 * report — and because it needs only the match and its audience, which the
 * context already holds.
 *
 * Idempotent by read-before-write, so no receipt gates it: a resumed run finds
 * the rows its predecessor minted and writes nothing. A silent-backfill match
 * mints none, decided inside the minter from the committed observation.
 */
export async function mintPostmatchNotificationIntentsV2(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutMintedIntentsV2Result> {
  const context = await resolveScoutV2MatchContext(input.riotMatchId);
  const summary = await mintPostmatchIntentsV2(prisma, {
    matchId: input.riotMatchId,
    puuids: context.trackedPlayers.map(
      (player) => player.league.leagueAccount.puuid,
    ),
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
