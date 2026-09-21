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
 * One committed object, named by content and location.
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
export type ScoutV2AttestedObject = z.infer<typeof ScoutV2AttestedObjectSchema>;
export const ScoutV2AttestedObjectSchema = z.strictObject({
  objectKey: S3ObjectKeySchema,
  digest: Sha256DigestSchema,
  bytes: z.int().positive(),
  contentType: z.string().min(1),
});

/**
 * Which message furniture v1's generator attached beside the report image.
 * `match-link` is the Explore "View match" button of a standard-queue report;
 * `match-link-mvp-vote` is that button plus community-MVP vote controls
 * and the empty tally embed. Arena and Classic reports attach nothing.
 * Recorded as a closed name rather than as the component JSON so the receipt
 * stays readable and a component v1 grows later cannot be attested under a
 * name that misdescribes it.
 */
export const ScoutV2ReportComponentsSchema = z.enum([
  "match-link",
  "match-link-mvp-vote",
  "none",
]);

/**
 * What a render receipt claims, by the KIND of notification it rendered.
 *
 * `report` is a post-match report: the image v1's generator rendered, and
 * everything else the message it built carried — the content line (with the
 * AI review's text when one was generated), the review's image when one was,
 * and which components were attached. The delivery rebuilds the message from
 * exactly this, so every fact that shaped it was captured ONCE, on the
 * background queue, at render time: the generator is what refetches ranks
 * and writes `MatchRankHistory`, and what spends the single AI review a
 * match is allowed, and neither may happen again per channel at the send.
 *
 * `image` is a loading screen: the prematch renderer's artifact, delivered
 * around v1's prematch payload built from the archived snapshot.
 *
 * `none` is the honest answer when there is nothing to read back.
 * `unsupported-queue` is the prematch renderer's for a queue the loading
 * screen does not support: v1 sends a text embed for those games, and the
 * V2 delivery does the same, but only because the render attested that there
 * is nothing to read — otherwise a missing artifact and an unsupported queue
 * would be indistinguishable at the send. `text-only` is a kind whose message
 * is text and embeds built at the send — settlement, dare summary — attested
 * so the send can tell "nothing to render" from "never rendered".
 *
 * Which variants a kind may attest is the reader's contract
 * (`notification/notification-artifact.ts`): a receipt attesting something
 * its kind cannot deliver is malformed, and the delivery parks the intent
 * rather than retrying a fact no re-read changes.
 */
export type ScoutV2NotificationRenderEvidence = z.infer<
  typeof ScoutV2NotificationRenderEvidenceSchema
>;
export const ScoutV2NotificationRenderEvidenceSchema = z.discriminatedUnion(
  "artifact",
  [
    z.strictObject({
      artifact: z.literal("report"),
      riotMatchId: RiotMatchIdSchema,
      image: ScoutV2AttestedObjectSchema,
      content: z.string().min(1),
      components: ScoutV2ReportComponentsSchema,
      review: ScoutV2AttestedObjectSchema.optional(),
    }),
    z.strictObject({
      artifact: z.literal("image"),
      riotMatchId: RiotMatchIdSchema,
      ...ScoutV2AttestedObjectSchema.shape,
    }),
    z.strictObject({
      artifact: z.literal("none"),
      riotMatchId: RiotMatchIdSchema,
      reason: z.enum(["unsupported-queue", "text-only"]),
    }),
  ],
);

/**
 * Version 2 added the `report` variant. No migration is defined because
 * none is honest: a version-1 receipt attested an image alone, and the
 * content and components the report variant carries were never captured —
 * inventing them would be exactly the in-place reinterpretation a version
 * bump exists to refuse. A version-1 envelope therefore fails the parse
 * loudly. No such envelope exists anywhere: the V2 workflows have no
 * production caller.
 */
export const SCOUT_V2_NOTIFICATION_RENDER_EVIDENCE_VERSION = 2;

export const scoutV2NotificationRenderEvidenceCodec = defineVersionedCodec({
  kind: "scout-v2-notification-render-evidence",
  version: SCOUT_V2_NOTIFICATION_RENDER_EVIDENCE_VERSION,
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
  return rendered?.evidence == null
    ? null
    : scoutV2NotificationRenderEvidenceCodec.parse(
        JSON.parse(rendered.evidence),
      );
}
