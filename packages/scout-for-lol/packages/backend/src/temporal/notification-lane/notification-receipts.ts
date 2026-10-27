import { z } from "zod";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import type { MatchNotificationIntentKind } from "@scout-for-lol/domain/notifications/intent.ts";
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
import type { DiscordGuildId } from "@scout-for-lol/data";
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
export const SCOUT_NOTIFICATION_RENDER_RECEIPT_KINDS = {
  postmatch: ReceiptKindSchema.parse("v2-notification-render-postmatch"),
  prematch: ReceiptKindSchema.parse("v2-notification-render-prematch"),
  "hall-record-break": ReceiptKindSchema.parse(
    "v2-notification-render-hall-record-break",
  ),
} as const satisfies Record<MatchNotificationIntentKind, ReceiptKind>;

/**
 * The receipt kind one intent kind's artifact is attested under. A closed
 * table rather than a derived string: a kind added to the domain fails the
 * `satisfies` above until it is named here, and the disjointness test in
 * `receipted-archive.test.ts` holds every named kind apart from the other
 * lanes' vocabularies.
 */
export function scoutNotificationRenderReceiptKind(
  kind: MatchNotificationIntentKind,
  presentation?: { guildId: DiscordGuildId; clashEnabled: boolean },
): ReceiptKind {
  if (kind === "prematch" && presentation !== undefined) {
    return ReceiptKindSchema.parse(
      presentation.clashEnabled
        ? "v2-notification-render-prematch-guild-clash"
        : "v2-notification-render-prematch-guild-ordinary",
    );
  }
  return SCOUT_NOTIFICATION_RENDER_RECEIPT_KINDS[kind];
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
export type ScoutAttestedObject = z.infer<typeof ScoutAttestedObjectSchema>;
export const ScoutAttestedObjectSchema = z.strictObject({
  objectKey: S3ObjectKeySchema,
  digest: Sha256DigestSchema,
  bytes: z.int().positive(),
  contentType: z.string().min(1),
});

/**
 * Which message furniture v1's generator attached beside the report image.
 * `inline-match-link` attests a link in the content and no components;
 * `inline-match-link-mvp-vote` adds community-MVP controls and the tally embed.
 * `match-link` and `match-link-mvp-vote` preserve the legacy button layouts.
 * Arena and Classic reports attach nothing. Recorded as a closed name rather
 * than as the component JSON so the receipt stays readable and a component v1
 * grows later cannot be attested under a name that misdescribes it.
 */
export const ScoutReportComponentsSchema = z.enum([
  "inline-match-link",
  "inline-match-link-mvp-vote",
  "match-link",
  "match-link-mvp-vote",
  "none",
]);

/**
 * Frozen message evidence for each notification kind. Post-match reports
 * contain the ordinary report image, content and component selection.
 */
export type ScoutNotificationRenderEvidence = z.infer<
  typeof ScoutNotificationRenderEvidenceSchema
>;
export const ScoutNotificationRenderEvidenceSchema = z.discriminatedUnion(
  "artifact",
  [
    z.strictObject({
      artifact: z.literal("report"),
      riotMatchId: RiotMatchIdSchema,
      image: ScoutAttestedObjectSchema,
      content: z.string().min(1),
      components: ScoutReportComponentsSchema,
    }),
    z.strictObject({
      artifact: z.literal("image"),
      riotMatchId: RiotMatchIdSchema,
      ...ScoutAttestedObjectSchema.shape,
    }),
    z.strictObject({
      artifact: z.literal("none"),
      riotMatchId: RiotMatchIdSchema,
      reason: z.enum(["unsupported-queue", "text-only"]),
    }),
  ],
);

/** Omitting the optional attachment is compatible with existing version-2 readers. */
export const SCOUT_NOTIFICATION_RENDER_EVIDENCE_VERSION = 2;

// Validate the exact historical contract before discarding its retired field.
// Persisted receipts and their original text remain unchanged in the database.
const Version2RenderEvidenceSchema = z.discriminatedUnion("artifact", [
  ScoutNotificationRenderEvidenceSchema.options[0].extend({
    review: ScoutAttestedObjectSchema.optional(),
  }),
  ScoutNotificationRenderEvidenceSchema.options[1],
  ScoutNotificationRenderEvidenceSchema.options[2],
]);

export const scoutNotificationRenderEvidenceCodec = defineVersionedCodec({
  kind: "scout-v2-notification-render-evidence",
  version: SCOUT_NOTIFICATION_RENDER_EVIDENCE_VERSION,
  schema: Version2RenderEvidenceSchema.transform((evidence) => {
    if (evidence.artifact !== "report") return evidence;
    const { review: _retiredReview, ...report } = evidence;
    return report;
  }),
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
export async function readNotificationArtifact(
  riotMatchId: RiotMatchId,
  kind: MatchNotificationIntentKind,
  presentation?: { guildId: DiscordGuildId; clashEnabled: boolean },
): Promise<ScoutNotificationRenderEvidence | null> {
  const receiptKind = scoutNotificationRenderReceiptKind(kind, presentation);
  const receipts = await listReceipts(prisma, { matchId: riotMatchId });
  const rendered = receipts.find(
    (record) =>
      record.receipt.kind === receiptKind &&
      (presentation === undefined
        ? record.receipt.scope.kind === "global"
        : record.receipt.scope.kind === "guild" &&
          record.receipt.scope.guildId === presentation.guildId),
  );
  return rendered?.evidence == null
    ? null
    : scoutNotificationRenderEvidenceCodec.parse(JSON.parse(rendered.evidence));
}
