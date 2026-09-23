import { MatchIdSchema } from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ReceiptKind } from "@scout-for-lol/domain/match-processing/states.ts";
import type {
  ScoutMatchCursorV2Result,
  ScoutMatchReceiptsV2Input,
  ScoutReceiptsV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import {
  ScoutDurableCommitV2Schema,
  type ScoutDurableCommitV2,
  type ScoutReceiptOutcomeV2,
} from "@scout-for-lol/temporal/contracts-v2";
import {
  SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
  SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
  scoutV2ClientMatchTerminalEvidenceCodec,
  scoutV2MatchPhaseOf,
  scoutV2MatchStageConflictEvidenceCodec,
  scoutV2MatchStageEvidenceCodec,
} from "@scout-for-lol/temporal/match-receipts-v2";
import { prisma } from "#src/database/index.ts";
import { advanceAccountCursor } from "#src/database/durable/account-cursor-repository.ts";
import { getObservation } from "#src/database/durable/observation-repository.ts";
import {
  listReceipts,
  recordReceipt,
} from "#src/database/durable/receipt-repository.ts";
import {
  listTrackedAccounts,
  markTrackedAccountCursorAdvanced,
} from "#src/database/durable/tracked-account-repository.ts";
import { dateFromIsoInstant } from "#src/database/durable/row-values.ts";
import { buildMatchReceipt } from "#src/durable/match/receipt-evidence.ts";
import { toIsoInstant } from "#src/durable/match/match-identity.ts";

/**
 * The V2 core's attestation and cursor steps, plus the one translation every
 * V2 Activity result depends on.
 *
 * v1's durable services record through `recordDurableWrite`, which is
 * fail-open by design: a recorder that cannot reach its tables must never be
 * able to block the authoritative pipeline. V2 inverts that. Here the durable
 * record IS the pipeline's memory — it is what a resumed Workflow reads to
 * decide which phases already happened — so a write that could not be made is
 * an Activity failure to be retried, not a metric to be counted. Every write
 * below therefore goes to the repository directly and reports its answer.
 */

/**
 * A repository answer in the V2 contracts' vocabulary.
 *
 * Parsed rather than mapped: the repositories already answer in exactly this
 * vocabulary, and parsing is what makes a repository that grows a new outcome
 * or a new conflict reason fail here instead of travelling as a shape the
 * Workflow cannot discriminate.
 */
export function durableCommitV2(result: unknown): ScoutDurableCommitV2 {
  return ScoutDurableCommitV2Schema.parse(result);
}

/** Record one evidence-bearing receipt strictly, and report what it answered. */
export async function recordMatchReceiptV2(args: {
  matchId: RiotMatchId;
  kind: ReceiptKind;
  evidence: { kind: string; version: number; data: unknown };
}): Promise<ScoutDurableCommitV2> {
  return durableCommitV2(
    await recordReceipt(
      prisma,
      buildMatchReceipt({
        matchId: args.matchId,
        kind: args.kind,
        scope: { kind: "global" },
        recordedAt: toIsoInstant(new Date()),
        evidence: args.evidence,
      }),
    ),
  );
}

/**
 * The evidence a receipt of this kind already carries for this match, or
 * `null` when no such receipt stands. Typed `unknown` because the evidence is
 * opaque JSON here — the caller owns the codec that gives it a shape.
 *
 * The read a TAKEOVER needs. A worker that committed its durable fact and died
 * before completing its claim leaves a standing receipt and a CLAIMED row; the
 * next attempt has to see that receipt before it decides to re-execute, or it
 * re-runs a state-gated effect that now finds nothing to do, records empty
 * evidence against the standing claim, and conflicts with it.
 */
export async function readMatchReceiptEvidenceV2(
  matchId: RiotMatchId,
  kind: ReceiptKind,
): Promise<unknown> {
  const receipts = await listReceipts(prisma, { matchId });
  const standing = receipts.find((record) => record.receipt.kind === kind);
  return standing?.evidence == null ? null : JSON.parse(standing.evidence);
}

/**
 * Attest to the phases this run completed.
 *
 * One Activity for the whole set, run after the last domain effect and before
 * the cursor moves, so the attestation is written once per run rather than
 * interleaved with the effects it describes. Each receipt's evidence is
 * derived from the match reference and the phase alone, which is what makes a
 * replay `already-applied` rather than a drift conflict; see
 * `match-receipts-v2.ts` for why the stage receipts are separate claims from
 * the evidence-bearing ones.
 *
 * A `conflict` is made DURABLE here, before it is reported. The Workflow
 * fails the run on it, but a failed run leaves no trace at the resume point:
 * the next execution would read the standing kind without the outcome that
 * contested it, skip the phase, and advance the cursor over the same drift.
 * So the Activity that met the conflict records
 * `SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND`, which the resume read
 * surfaces and the Workflow refuses to proceed past. Recorded strictly: a
 * marker that could not be written is an Activity failure to retry, not a
 * drift that quietly stopped being visible.
 */
export async function recordMatchReceiptsV2(
  input: ScoutMatchReceiptsV2Input,
): Promise<ScoutReceiptsV2Result> {
  const receipts: ScoutReceiptOutcomeV2[] = [];
  for (const kind of input.kinds) {
    const commit = await recordMatchReceiptV2({
      matchId: input.riotMatchId,
      kind,
      evidence: scoutV2MatchStageEvidenceCodec.serialize({
        riotMatchId: input.riotMatchId,
        phase: scoutV2MatchPhaseOf(kind),
      }),
    });
    receipts.push({ kind, commit });
  }
  if (receipts.some((receipt) => receipt.commit.outcome === "conflict")) {
    await markStageReceiptsContested(input.riotMatchId);
  }
  return { receipts };
}

/** Persist the dispatcher's terminal/review outcome before it advances. */
export async function recordClientMatchTerminalV2(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutDurableCommitV2> {
  const marker = await recordMatchReceiptV2({
    matchId: input.riotMatchId,
    kind: SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
    evidence: scoutV2ClientMatchTerminalEvidenceCodec.serialize({
      riotMatchId: input.riotMatchId,
    }),
  });
  if (marker.outcome === "conflict") {
    throw new Error(
      `The client-match terminal marker for ${input.riotMatchId} conflicts (${marker.reason}); its evidence names only the match, so this is a broken contract`,
    );
  }
  return marker;
}

/**
 * Record that a stage receipt for this match is contested. The evidence names
 * the match alone, so a second contested phase on the same match is
 * `already-applied` rather than a conflict about a conflict.
 */
async function markStageReceiptsContested(matchId: RiotMatchId): Promise<void> {
  const marker = await recordMatchReceiptV2({
    matchId,
    kind: SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND,
    evidence: scoutV2MatchStageConflictEvidenceCodec.serialize({
      riotMatchId: matchId,
    }),
  });
  if (marker.outcome === "conflict") {
    throw new Error(
      `The stage-conflict marker for ${matchId} itself conflicts (${marker.reason}); its evidence names only the match, so this is a broken contract`,
    );
  }
}

/**
 * Advance every tracked account's processing cursor off this match.
 *
 * Two writes per account, both monotonic and each guarding a different thing.
 * `Account` carries the authoritative cursor the next poll reads, and
 * `advanceAccountCursor` refuses to move it backwards — a V2 retry of an
 * OLDER match can be scheduled after a newer match already advanced the same
 * account, and an unconditional write would rewind the cursor and re-open
 * matches for re-ingestion and re-announcement.
 * `MatchTrackedAccount.cursorAdvancedAt` records separately that THIS match
 * reached its cursor stage.
 *
 * The association is marked even when the account cursor refuses, and that is
 * deliberate: the two answer different questions. The refusal means a newer
 * match already carried the account past this one, which does not make this
 * match's cursor step unfinished — and leaving the association unmarked would
 * make every resumed run retry a step that can never apply again.
 *
 * The counts follow the ACCOUNT cursor, because that is the cursor whose
 * rewind the guard exists to prevent and the one an operator reading
 * `advanced` is asking about. A match whose accounts have all moved on
 * reports `alreadyAdvanced`, which is the honest answer rather than a
 * conflict: a newer cursor is progress, not two producers disagreeing.
 *
 * The association rows are the unit, not the registered accounts. A row whose
 * `accountId` is NULL is a PUUID that was tracked but unregistered when the
 * match was observed, and one whose `accountId` no longer resolves was
 * deregistered since; both still played in this match, and both still have a
 * cursor keyed by PUUID. Advancing by PUUID is what keeps the two histories
 * from having to be told apart here.
 */
export async function advanceMatchCursorV2(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutMatchCursorV2Result> {
  const observation = await getObservation(prisma, {
    matchId: input.riotMatchId,
  });
  if (observation === null) {
    throw new Error(
      `Cannot advance cursors for ${input.riotMatchId}: the match was never observed`,
    );
  }
  const matchTime = dateFromIsoInstant(observation.gameCreatedAt);
  const matchId = MatchIdSchema.parse(input.riotMatchId);
  const tracked = await listTrackedAccounts(prisma, {
    matchId: input.riotMatchId,
  });
  const advancedAt = toIsoInstant(new Date());
  let advanced = 0;
  let alreadyAdvanced = 0;
  for (const association of tracked) {
    const cursor = await advanceAccountCursor(prisma, {
      puuid: association.puuid,
      matchId,
      matchTime,
    });
    await markTrackedAccountCursorAdvanced(prisma, {
      matchId: input.riotMatchId,
      puuid: association.puuid,
      advancedAt,
    });
    if (cursor.outcome === "applied") advanced += 1;
    else alreadyAdvanced += 1;
  }
  return { advanced, alreadyAdvanced };
}
