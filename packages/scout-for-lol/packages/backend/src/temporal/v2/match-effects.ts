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
  checkpointFailureIn,
  SettlementCheckpointError,
  silentSettlementSink,
  type SettlementAnnouncementSink,
} from "#src/betting/notify/announcement-sink.ts";
import { runGuardedEffectV2 } from "#src/temporal/v2/effect-fence.ts";
import { durableCommitV2 } from "#src/temporal/v2/match-commits.ts";
import {
  readMatchReceiptEvidenceV2,
  recordMatchReceiptV2,
} from "#src/temporal/v2/match-commits.ts";
import { resolveScoutV2ObservedMatchContext } from "#src/temporal/v2/match-context.ts";
import {
  matchMayAnnounce,
  mintLateBindingEarningIntentsV2,
  mintDareSummaryIntentsV2,
  recoveredSettlementRecordsOf,
  mintPostmatchIntentsV2,
  mintSettlementIntentsV2,
  recoveredAnnouncementsOf,
  recoveredLateBindingEarningsOf,
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
  mayAnnounce: boolean,
): SettlementAnnouncementSink {
  return {
    ...silentSettlementSink,
    // Announcement ELIGIBILITY varies; recovery evidence does not. A live V2
    // match may still post a callout for a Dare that has none and still owes
    // its Dare DMs, both being v1 surfaces the gate's promise permits for a
    // match a live discovery surfaced. A backfill owes neither.
    ...(mayAnnounce
      ? {
          mayPostDareCallout: announcingSettlementSink.mayPostDareCallout,
          mayEnqueueDareNotification:
            announcingSettlementSink.mayEnqueueDareNotification,
        }
      : {}),
    recordAnnouncementItem: async (db, item) => {
      // EVERY failure leaves here as a `SettlementCheckpointError`, not just
      // the conflict. A connection blip writing this row loses the settlement
      // the same way a conflicting row does — the producing transaction rolls
      // back and its caller, which catches broadly, would otherwise record a
      // receipt over a pool nobody was paid from. The type is what the
      // handlers between here and the Activity recognise.
      const commit = await (async () => {
        try {
          return durableCommitV2(
            await recordSettlementAnnouncementItem(db, {
              matchId: riotMatchId,
              item,
            }),
          );
        } catch (error) {
          throw new SettlementCheckpointError({
            family: item.family,
            itemKey: item.itemKey,
            // A write that failed outright may well succeed next time; the
            // transaction rolled back, so the retry re-settles from scratch.
            retryable: true,
            message: `Could not checkpoint the ${item.family} announcement ${item.itemKey} for ${riotMatchId}, so the settlement that produced it rolled back`,
            cause: error,
          });
        }
      })();
      if (commit.outcome !== "conflict") return;
      throw new SettlementCheckpointError({
        family: item.family,
        itemKey: item.itemKey,
        // Two producers disagreeing about what ONE settlement produced. No
        // retry resolves that, and overwriting would destroy the only record
        // of what the first one did.
        retryable: false,
        message: `A settlement announcement already stands for ${riotMatchId} (${item.family}/${item.itemKey}) with different instructions (${commit.reason}); refusing to overwrite the only record of what that transition produced`,
        cause: undefined,
      });
    },
  };
}

/**
 * Checkpoint earnings created after the ordinary settlement lane completed.
 *
 * The distinct family keeps a retry from folding old settlement earnings into
 * the new earnings-only notification and announcing them twice.
 */
export function lateBindingEarningsCheckpointSink(
  riotMatchId: RiotMatchId,
  mayAnnounce: boolean,
): SettlementAnnouncementSink {
  const sink = checkpointingSettlementSink(riotMatchId, mayAnnounce);
  return {
    ...sink,
    recordAnnouncementItem: async (db, item) => {
      if (item.family !== "earnings") {
        throw new Error(
          `Late-binding earnings attempted to checkpoint unexpected ${item.family} announcement`,
        );
      }
      await sink.recordAnnouncementItem(db, {
        ...item,
        family: "late-earnings",
      });
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

/**
 * Mint every late-binding earnings instruction currently standing for a match.
 *
 * Late binding can add earnings after the ordinary match Workflow has already
 * planned fan-out. Persisting the instruction with the earning makes that
 * transition recoverable; the distinct family excludes earnings the ordinary
 * settlement recap already announced. Minting the late-binding set is
 * idempotent, and the reconciliation sweep drives any newly created intent.
 */
export async function mintStandingLateBindingEarningIntentsV2(input: {
  riotMatchId: RiotMatchId;
  gameCreation: number;
}): Promise<void> {
  const standing = await listSettlementAnnouncementItems(prisma, {
    matchId: input.riotMatchId,
  });
  await mintLateBindingEarningIntentsV2(prisma, {
    matchId: input.riotMatchId,
    earnings: recoveredLateBindingEarningsOf(standing),
    gameCreation: input.gameCreation,
    createdAt: new Date(),
  });
}

/**
 * Run the settlement, giving a checkpoint failure the retryability it needs.
 *
 * A checkpoint failure reaches here as a {@link SettlementCheckpointError}
 * rather than as an `ApplicationFailure`, because the type has to travel
 * through the betting slice's broad handlers first and those recognise it by
 * class. Temporal decides retries from what the ACTIVITY throws, so the
 * translation happens at that boundary: drift between two producers is
 * non-retryable and pages, while a failed write is left retryable, since its
 * transaction rolled back and the next attempt settles from scratch.
 */
async function settledWithCheckpointFailuresSurfaced<T>(
  riotMatchId: RiotMatchId,
  settle: () => Promise<T>,
): Promise<T> {
  try {
    return await settle();
  } catch (error) {
    const checkpoint = checkpointFailureIn(error);
    if (checkpoint === undefined || checkpoint.retryable) throw error;
    throw ApplicationFailure.nonRetryable(
      `${checkpoint.message} (settling ${riotMatchId})`,
      "DurableCommitConflict",
    );
  }
}

/**
 * Everything this match settled, across every attempt that touched it.
 *
 * This attempt's own return value plus the records its standing checkpoints
 * attest to. Duplicates are harmless: the evidence builder canonicalises each
 * identity set, so a pool present in both appears once.
 */
function settledRecordsAcrossAttempts(
  bucks: Awaited<ReturnType<typeof settleBucksWithDareTimelineV2>>["bucks"],
  standing: readonly SettlementAnnouncementItem[],
): Awaited<ReturnType<typeof settleBucksWithDareTimelineV2>>["bucks"] {
  const recorded = recoveredSettlementRecordsOf(standing);
  return {
    ...bucks,
    closures: [...bucks.closures, ...recorded.closures],
    settlements: [...bucks.settlements, ...recorded.settlements],
    parlaySettlements: [
      ...bucks.parlaySettlements,
      ...recorded.parlaySettlements,
    ],
    earnings: [...bucks.earnings, ...recorded.earnings],
    dareSettlements: [...bucks.dareSettlements, ...recorded.dareSettlements],
  };
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
      // costs no Riot read at all. The OBSERVED roster, because settlement runs
      // after the observation commits: a live rebuild would settle only for the
      // accounts whose guild this worker's gateway cache happens to hold.
      const context = await resolveScoutV2ObservedMatchContext(
        input.riotMatchId,
      );
      // Settlement is ENTERED even when checkpoints already stand.
      //
      // A standing checkpoint used to short-circuit this, on the reasoning
      // that a previous attempt had settled the match and only its
      // announcements were missing. That reasoning held for the attempt that
      // finished and not for the one that stopped half way: an attempt whose
      // first pool checkpointed and whose second failed leaves exactly one
      // row, and reading "a row exists" as "settlement completed" retired the
      // match with its second pool closed and its bettors unpaid.
      //
      // "Some checkpoints exist" was never a completion marker. The RECEIPT
      // is, and it is checked before this runs, so reaching here means no
      // attempt has completed and re-entering is right. Re-entry is safe
      // because every step is state-gated on its own durable row: a settled
      // pool is no longer matched-and-closed, a terminal Dare returns nothing,
      // an earned guild carries its marker. A resumption therefore settles
      // exactly what is left, which is the whole point.
      //
      // What the checkpoints are for is the OTHER half — results that a
      // re-run legitimately no longer returns — and that half is served below,
      // where both the mint and the receipt read every standing instruction
      // rather than only this attempt's output.
      //
      // The Riot read above can take as long as Riot takes; the fence may
      // have lapsed while it ran, and the ledger must not be entered on a
      // lock this attempt no longer holds.
      await fence.assertHeld();
      // The sink decides whether anything this settlement produces may be
      // announced, and it is built from the COMMITTED delivery mode rather
      // than from anything this run was handed. A backfilled match settles in
      // full and announces nothing: no summaries delivered from the partial
      // path, no Dare DMs drained from the outbox, no callout posted.
      const settled = await settledWithCheckpointFailuresSurfaced(
        input.riotMatchId,
        async () =>
          await settleBucksWithDareTimelineV2({
            matchData: context.matchData,
            matchDataSource: context.matchDataSource,
            trackedPlayers: context.trackedPlayers,
            prismaClient: prisma,
            // One sink either way, because the two concerns it used to fuse
            // are different questions. WHETHER TO ANNOUNCE depends on the
            // committed delivery mode; WHETHER TO RECORD does not. A silent
            // match that recorded nothing left a retry with state-gated
            // nothing and no standing instruction, and the receipt then
            // attested a settlement with no ledger identities although the
            // money had moved. The mint reads the same committed mode and
            // withholds the notifications; the evidence stays durable.
            announcementSink: checkpointingSettlementSink(
              input.riotMatchId,
              await matchMayAnnounce(prisma, input.riotMatchId),
            ),
          }),
      );
      // Every instruction standing for this match, which is this attempt's
      // output UNION whatever an earlier attempt checkpointed before it
      // stopped. Read after the writes above so it includes them.
      await fence.assertHeld();
      const standing = await listSettlementAnnouncementItems(prisma, {
        matchId: input.riotMatchId,
      });
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
        standing,
        context.matchData.info.gameCreation,
      );
      await fence.assertHeld();
      // The receipt names what the MATCH settled, not what this attempt did.
      // A resumption settles only what was left, so evidence built from its
      // own return value alone would record an empty settlement for a match
      // whose bets are all resolved — a durable record saying the opposite of
      // what happened.
      const attested = settlementEvidenceOf(
        settledRecordsAcrossAttempts(settled.bucks, standing),
      );
      return {
        fact: await recordMatchReceiptV2({
          matchId: input.riotMatchId,
          kind: MATCH_RECEIPT_KINDS.settlement,
          evidence: settlementEvidenceCodec.serialize(attested),
        }),
        effects: settledRecordCount(attested),
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
      // The OBSERVED roster. This stage is the one where a live rebuild does
      // lasting damage rather than transient: `trackedAccountCount` below is
      // written into the receipt, so a roster narrowed by this worker's gateway
      // cache would become durable evidence attesting the wrong number, and a
      // later reader has no way to tell it from the truth.
      const context = await resolveScoutV2ObservedMatchContext(
        input.riotMatchId,
      );
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
  const context = await resolveScoutV2ObservedMatchContext(input.riotMatchId);
  const summary = await mintPostmatchIntentsV2(prisma, {
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
