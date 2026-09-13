import { z } from "zod";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  ReceiptKindSchema,
  type ReceiptKind,
} from "@scout-for-lol/domain/match-processing/states.ts";
import { SCOUT_V2_CONTRACT_VERSION } from "./contracts-v2.ts";

/**
 * The receipt kinds the V2 per-match core records, and what they attest to.
 *
 * These are STAGE receipts, and they are a different claim from the
 * evidence-bearing receipts the pipeline already writes. `settlement` says
 * which bets, Dares and awards a commit moved; `v2-match-settlement` says that
 * the V2 core's settlement phase completed for this match. The distinction is
 * load-bearing in two directions.
 *
 * Reading: `scoutMatchProcessingV2Workflow` resumes off `receiptKinds` in the
 * pipeline state, and a phase gate has to be answerable from the identifiers
 * the Workflow already holds. An evidence-bearing receipt cannot serve that
 * role — its evidence is the settled bet ids, which no resumed run can
 * reconstruct, so a run that had to re-assert one would either invent evidence
 * or record a conflict against the first writer's.
 *
 * Writing: a stage receipt's evidence is derived from the match reference and
 * the phase alone, so every replay serializes byte-identical evidence and the
 * repository answers `already-applied` rather than `receipt-evidence-mismatch`.
 * That is what makes `recordMatchReceiptsV2` safe to call on every attempt.
 *
 * The `v2-` prefix keeps the vocabulary disjoint from v1's, so a match the
 * legacy pipeline processed can never look to V2 like a phase it already ran —
 * which matters precisely while both pipelines are live.
 */
export const SCOUT_V2_MATCH_RECEIPT_KINDS = {
  archive: ReceiptKindSchema.parse("v2-match-archive"),
  observation: ReceiptKindSchema.parse("v2-match-observation"),
  settlement: ReceiptKindSchema.parse("v2-match-settlement"),
  progression: ReceiptKindSchema.parse("v2-match-progression"),
} as const;

/**
 * The phases of the per-match serial core that leave a durable effect behind,
 * in the order the Workflow runs them.
 *
 * The cursor advance is deliberately absent. It has no stage receipt because
 * it already has a better durable signal: `MatchTrackedAccount.cursorAdvancedAt`
 * is per account and monotonic, so `trackedAccounts.cursorAdvanced` in the
 * pipeline state answers "did this happen" more precisely than a single
 * match-wide receipt could, and the repository guard makes a repeat a no-op.
 */
export const SCOUT_V2_MATCH_PHASES = [
  "archive",
  "observation",
  "settlement",
  "progression",
] as const;
export type ScoutV2MatchPhase = (typeof SCOUT_V2_MATCH_PHASES)[number];

export const ScoutV2MatchStageEvidenceSchema = z.strictObject({
  riotMatchId: RiotMatchIdSchema,
  phase: z.enum(SCOUT_V2_MATCH_PHASES),
});
export type ScoutV2MatchStageEvidence = z.infer<
  typeof ScoutV2MatchStageEvidenceSchema
>;

export const scoutV2MatchStageEvidenceCodec = defineVersionedCodec({
  kind: "scout-v2-match-stage-evidence",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutV2MatchStageEvidenceSchema,
});

const PHASE_BY_RECEIPT_KIND = new Map<ReceiptKind, ScoutV2MatchPhase>(
  SCOUT_V2_MATCH_PHASES.map((phase) => [
    SCOUT_V2_MATCH_RECEIPT_KINDS[phase],
    phase,
  ]),
);

/**
 * The phase a V2 stage receipt kind names.
 *
 * Throws for anything else, and that is the point: `recordMatchReceiptsV2`
 * accepts any `ReceiptKind` because the frozen Activity contract does, so this
 * is where a caller asking the V2 core to attest to a kind it does not own
 * fails loudly instead of writing a receipt whose evidence claims a phase that
 * never ran.
 */
export function scoutV2MatchPhaseOf(kind: ReceiptKind): ScoutV2MatchPhase {
  const phase = PHASE_BY_RECEIPT_KIND.get(kind);
  if (phase === undefined) {
    throw new Error(
      `Receipt kind ${kind} is not one the V2 per-match core owns; it cannot attest to a phase`,
    );
  }
  return phase;
}
