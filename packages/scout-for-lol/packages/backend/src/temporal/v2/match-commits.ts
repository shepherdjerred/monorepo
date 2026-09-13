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
  scoutV2MatchPhaseOf,
  scoutV2MatchStageEvidenceCodec,
} from "@scout-for-lol/temporal/match-receipts-v2";
import { prisma, updateLastProcessedMatch } from "#src/database/index.ts";
import { getObservation } from "#src/database/durable/observation-repository.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
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
 * Attest to the phases this run completed.
 *
 * One Activity for the whole set, run after the last domain effect and before
 * the cursor moves, so the attestation is written once per run rather than
 * interleaved with the effects it describes. Each receipt's evidence is
 * derived from the match reference and the phase alone, which is what makes a
 * replay `already-applied` rather than a drift conflict; see
 * `match-receipts-v2.ts` for why the stage receipts are separate claims from
 * the evidence-bearing ones.
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
  return { receipts };
}

/**
 * Advance every tracked account's processing cursor off this match.
 *
 * Two writes per account, in v1's order and with v1's meaning: `Account`
 * carries the authoritative cursor the next poll reads, and
 * `MatchTrackedAccount.cursorAdvancedAt` records that this match is what moved
 * it. The durable guard is monotonic, so a delayed retry cannot rewind an
 * advance that already moved past this match — which would re-open the match
 * for re-ingestion and re-announcement.
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
    await updateLastProcessedMatch(
      association.puuid,
      matchId,
      prisma,
      matchTime,
    );
    const result = await markTrackedAccountCursorAdvanced(prisma, {
      matchId: input.riotMatchId,
      puuid: association.puuid,
      advancedAt,
    });
    if (result.outcome === "applied") advanced += 1;
    else alreadyAdvanced += 1;
  }
  return { advanced, alreadyAdvanced };
}
