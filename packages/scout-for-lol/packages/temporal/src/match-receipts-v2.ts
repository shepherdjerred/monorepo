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
  tournament: ReceiptKindSchema.parse("v2-match-tournament"),
} as const;

/**
 * The phases of the per-match serial core that leave a durable effect behind,
 * in the order the Workflow runs them.
 *
 * `tournament` is the durable legacy name for managed-custom finalization. It
 * runs last because it publishes a Custom Night projection and must not do so
 * before the domain effects it describes have committed.
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
  "tournament",
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

/**
 * The receipt that says a stage receipt for this match is CONTESTED.
 *
 * A contested stage receipt fails the run that met it — but a failed run is
 * not durable. Under `ALLOW_DUPLICATE_FAILED_ONLY` the next discovery starts
 * a fresh execution, and that execution's resume read sees the standing kind
 * WITHOUT the outcome that contested it: it skips the phase, skips the
 * attestation, and advances the cursor over the same disagreement one poll
 * later. The drift has to live where the resume point reads, so the Activity
 * that met the conflict records this marker and every later execution fails
 * before its first phase until an operator has looked and removed it.
 *
 * Same shape as `v2-recovery-conflict` (the durable tail's marker), and for
 * the same reason the evidence names the match alone: receipt identity is
 * `(kind, version, scope)` within one match, so a second contested phase on
 * the same match writes the same identity, and evidence naming the phase
 * would make that write a conflict about a conflict. Which phase was
 * contested is in the failed run's error and in the receipts themselves.
 */
export const SCOUT_V2_MATCH_STAGE_CONFLICT_RECEIPT_KIND: ReceiptKind =
  ReceiptKindSchema.parse("v2-match-stage-conflict");

export type ScoutV2MatchStageConflictEvidence = z.infer<
  typeof ScoutV2MatchStageConflictEvidenceSchema
>;
export const ScoutV2MatchStageConflictEvidenceSchema = z.strictObject({
  riotMatchId: RiotMatchIdSchema,
});

export const scoutV2MatchStageConflictEvidenceCodec = defineVersionedCodec({
  kind: "scout-v2-match-stage-conflict-evidence",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutV2MatchStageConflictEvidenceSchema,
});

/**
 * The shared client dispatcher reached a deterministic failure that requires
 * operator review. This lives beside the match's other durable receipts so an
 * HTTP retry can distinguish a terminal reconciliation from work that is
 * merely still in flight.
 */
export const SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND: ReceiptKind =
  ReceiptKindSchema.parse("v2-client-match-terminal");

export const ScoutV2ClientMatchTerminalEvidenceSchema = z.strictObject({
  riotMatchId: RiotMatchIdSchema,
});
export type ScoutV2ClientMatchTerminalEvidence = z.infer<
  typeof ScoutV2ClientMatchTerminalEvidenceSchema
>;

export const scoutV2ClientMatchTerminalEvidenceCodec = defineVersionedCodec({
  kind: "scout-v2-client-match-terminal-evidence",
  version: SCOUT_V2_CONTRACT_VERSION,
  schema: ScoutV2ClientMatchTerminalEvidenceSchema,
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
