import { z } from "zod";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import {
  RiotMatchIdSchema,
  S3ObjectKeySchema,
  Sha256DigestSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  ReceiptKindSchema,
  type ReceiptKind,
} from "@scout-for-lol/domain/match-processing/states.ts";
import { RECEIPT_VERSION } from "#src/report-lake/durable-receipts.ts";
import { prisma } from "#src/database/index.ts";
import { listReceipts } from "#src/database/durable/receipt-repository.ts";

/**
 * The receipt the V2 notification lane owns, and what it attests to.
 *
 * `ReceiptKind` is a branded kebab-case string rather than a closed set
 * precisely so the workflow that emits a kind is the one that names it, and
 * this is that naming for the rendered report artifact. The kind is disjoint
 * from v1's vocabulary and from the match lane's `v2-match-*` stage receipts,
 * so a match the legacy pipeline reported on can never look to V2 like an
 * artifact it already committed.
 *
 * ## Why the receipt is per MATCH and not per intent
 *
 * A receipt's identity is `(kind, version, scope)` within one match, and the
 * scope vocabulary is global, guild or account. An intent is keyed by channel,
 * which is none of those — a per-intent receipt is simply not representable.
 * That turns out to be the right shape anyway: the rendered report is a
 * property of the match, and every channel subscribed to it receives the same
 * image. One render, one artifact, one attestation, however many intents fan
 * out from it.
 */
export const SCOUT_V2_NOTIFICATION_RENDER_RECEIPT_KIND: ReceiptKind =
  ReceiptKindSchema.parse("v2-notification-render");

/**
 * What a render receipt claims: which bytes were committed, and where.
 *
 * Deliberately NOT an `ArtifactDescriptor`, whose `capturedAt` is stamped at
 * put time. Two runs that render the same match would then record genuinely
 * different evidence and the second would lose to `receipt-evidence-mismatch`
 * — a drift signal raised by nothing drifting. Naming the content and the
 * location alone makes a repeat byte-identical, so the repository answers
 * `already-applied` and the first writer's artifact stands.
 *
 * The object key stays in the evidence because it is the only way a later
 * reader finds the bytes: the render Activity's own result is `rendered` or
 * `reused` and carries no descriptor, by contract.
 */
export type ScoutV2NotificationRenderEvidence = z.infer<
  typeof ScoutV2NotificationRenderEvidenceSchema
>;
export const ScoutV2NotificationRenderEvidenceSchema = z.strictObject({
  riotMatchId: RiotMatchIdSchema,
  objectKey: S3ObjectKeySchema,
  digest: Sha256DigestSchema,
  bytes: z.int().positive(),
  contentType: z.string().min(1),
});

export const scoutV2NotificationRenderEvidenceCodec = defineVersionedCodec({
  kind: "scout-v2-notification-render-evidence",
  version: RECEIPT_VERSION,
  schema: ScoutV2NotificationRenderEvidenceSchema,
});

/**
 * The artifact this match's notifications deliver, read back from its own
 * receipt.
 *
 * The receipt is the hand-off between two Activities that share no memory and
 * do not even share a task queue — rendering runs on `background` so a slow
 * Satori pass never sits in front of a live match, while delivery runs on
 * `realtime`. A key reconstructed from the layout convention would be evidence
 * of nothing; the receipt names the bytes that were actually committed.
 */
export async function readNotificationArtifactV2(
  riotMatchId: RiotMatchId,
): Promise<ScoutV2NotificationRenderEvidence | null> {
  const receipts = await listReceipts(prisma, { matchId: riotMatchId });
  const rendered = receipts.find(
    (record) =>
      record.receipt.kind === SCOUT_V2_NOTIFICATION_RENDER_RECEIPT_KIND,
  );
  if (rendered?.evidence == null) {
    return null;
  }
  return scoutV2NotificationRenderEvidenceCodec.parse(
    JSON.parse(rendered.evidence),
  );
}
