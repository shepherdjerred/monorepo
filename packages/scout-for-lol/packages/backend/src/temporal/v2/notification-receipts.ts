import { z } from "zod";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import type { NotificationIntentKind } from "@scout-for-lol/domain/notifications/intent.ts";
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
 * The receipts the V2 notification lane owns, and what they attest to.
 *
 * `ReceiptKind` is a branded kebab-case string rather than a closed set
 * precisely so the workflow that emits a kind is the one that names it, and
 * this is that naming for the rendered notification artifact. The kinds are
 * disjoint from v1's vocabulary and from the match lane's `v2-match-*` stage
 * receipts, so a match the legacy pipeline reported on can never look to V2
 * like an artifact it already committed.
 *
 * ## Why the receipt is per MATCH AND KIND, not per intent
 *
 * A receipt's identity is `(kind, version, scope)` within one match, and the
 * scope vocabulary is global, guild or account. An intent is keyed by channel,
 * which is none of those — a per-intent receipt is simply not representable.
 * That is the right shape for one kind of announcement: the rendered image is
 * a property of the match, and every channel subscribed to it receives the
 * same one. One render, one artifact, one attestation, however many intents
 * fan out from it.
 *
 * It is NOT the right shape across kinds. A prematch intent and a postmatch
 * intent name the same match id — the snapshot is keyed by the id Riot later
 * assigns — and render different images. One receipt kind for both would let
 * whichever rendered first stand for the other, and a post-match report would
 * be delivered carrying the loading screen. So the receipt kind carries the
 * intent kind.
 */
export const SCOUT_V2_NOTIFICATION_RENDER_RECEIPT_KINDS = {
  postmatch: ReceiptKindSchema.parse("v2-notification-render-postmatch"),
  prematch: ReceiptKindSchema.parse("v2-notification-render-prematch"),
  settlement: ReceiptKindSchema.parse("v2-notification-render-settlement"),
  "dare-summary": ReceiptKindSchema.parse(
    "v2-notification-render-dare-summary",
  ),
} as const satisfies Record<NotificationIntentKind, ReceiptKind>;

/**
 * The receipt kind one intent kind's artifact is attested under. A closed
 * table rather than a derived string: a kind added to the domain fails the
 * `satisfies` above until it is named here, and the disjointness test in
 * `receipted-archive.test.ts` holds every named kind apart from the other
 * lanes' vocabularies.
 */
export function scoutV2NotificationRenderReceiptKind(
  kind: NotificationIntentKind,
): ReceiptKind {
  return SCOUT_V2_NOTIFICATION_RENDER_RECEIPT_KINDS[kind];
}

/**
 * What a render receipt claims: which bytes were committed, and where — or
 * that this match's notification has no image at all.
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
 *
 * `none` is the prematch renderer's honest answer for a queue the loading
 * screen does not support: v1 sends a text embed for those games, and the
 * V2 delivery does the same, but it can only do so if the render attested
 * that there is nothing to read back — otherwise a missing artifact and an
 * unsupported queue would be indistinguishable at the send.
 *
 * The union replaced the flat image shape in place rather than under a new
 * version because no `v2-notification-render` receipt exists anywhere: the
 * V2 workflows have no production caller yet.
 */
export type ScoutV2NotificationRenderEvidence = z.infer<
  typeof ScoutV2NotificationRenderEvidenceSchema
>;
export const ScoutV2NotificationRenderEvidenceSchema = z.discriminatedUnion(
  "artifact",
  [
    z.strictObject({
      artifact: z.literal("image"),
      riotMatchId: RiotMatchIdSchema,
      objectKey: S3ObjectKeySchema,
      digest: Sha256DigestSchema,
      bytes: z.int().positive(),
      contentType: z.string().min(1),
    }),
    z.strictObject({
      artifact: z.literal("none"),
      riotMatchId: RiotMatchIdSchema,
      /**
       * `unsupported-queue`: a prematch game the loading screen cannot draw,
       * delivered with v1's fallback embed. `text-only`: a kind whose message
       * is text and embeds built at the send — settlement, dare summary —
       * attested so the send can tell "nothing to render" from "never
       * rendered".
       */
      reason: z.enum(["unsupported-queue", "text-only"]),
    }),
  ],
);

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
  kind: NotificationIntentKind,
): Promise<ScoutV2NotificationRenderEvidence | null> {
  const receiptKind = scoutV2NotificationRenderReceiptKind(kind);
  const receipts = await listReceipts(prisma, { matchId: riotMatchId });
  const rendered = receipts.find(
    (record) => record.receipt.kind === receiptKind,
  );
  if (rendered?.evidence == null) {
    return null;
  }
  return scoutV2NotificationRenderEvidenceCodec.parse(
    JSON.parse(rendered.evidence),
  );
}
