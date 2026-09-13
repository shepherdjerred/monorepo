import { z } from "zod";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  ReceiptKindSchema,
  type ReceiptKind,
} from "@scout-for-lol/domain/match-processing/states.ts";
import { RECEIPT_VERSION } from "#src/report-lake/durable-receipts.ts";

/**
 * The receipt a recovery batch records for a match it could not recover.
 *
 * A batch's tally already counts conflicts, and a count is not enough: it tells
 * an operator that three matches are a person's problem without saying WHICH
 * three, and the only route from a count back to the ids is a scan over every
 * match in the batch's range. The receipt names them. `MatchProcessingReceipt`
 * is indexed by `(kind, recordedAt)`, so "every match a recovery batch
 * conflicted on, most recent first" is an indexed lookup rather than a scan.
 *
 * ## Why this is a receipt and not an operator audit event
 *
 * `ScoutOperatorAuditEvent` requires an `actorDiscordId`, because it records
 * what a PERSON did. A recovery conflict is something a batch noticed, and
 * there is no honest actor to name: the bot's `APPLICATION_ID` is not
 * guaranteed to be a snowflake — the repository's own `test.env` and
 * `example.env` both set it to `test` — so parsing it into a Discord account id
 * would fail in exactly the environments that run the tests, and inventing a
 * snowflake would put fabricated identity in an audit log. A receipt asks for
 * no actor because it attests to a fact about a match, which is precisely what
 * this is.
 *
 * ## Why the evidence does not name the batch
 *
 * Receipt identity is `(kind, version, scope)` within one match, so a second
 * batch that conflicts on the same match writes the same identity. If the
 * evidence carried the batch id, that write would differ from the first and be
 * answered `receipt-evidence-mismatch` — a conflict about a conflict, and a
 * failure raised by the system working correctly. The fact worth attesting is
 * "recovering this match conflicted", which is true whichever batch noticed, so
 * the evidence names the match alone and a repeat is `already-applied`. Which
 * batch saw it is recoverable from `recordedAt` against the batch's own run
 * window, and the batch's tally already says how many it hit.
 */
export const SCOUT_V2_RECOVERY_CONFLICT_RECEIPT_KIND: ReceiptKind =
  ReceiptKindSchema.parse("v2-recovery-conflict");

export type ScoutV2RecoveryConflictEvidence = z.infer<
  typeof ScoutV2RecoveryConflictEvidenceSchema
>;
export const ScoutV2RecoveryConflictEvidenceSchema = z.strictObject({
  riotMatchId: RiotMatchIdSchema,
});

export const scoutV2RecoveryConflictEvidenceCodec = defineVersionedCodec({
  kind: "scout-v2-recovery-conflict-evidence",
  version: RECEIPT_VERSION,
  schema: ScoutV2RecoveryConflictEvidenceSchema,
});
