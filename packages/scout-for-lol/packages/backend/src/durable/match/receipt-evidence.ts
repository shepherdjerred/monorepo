import { z } from "zod";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import {
  DiscordMessageIdSchema,
  type IsoInstant,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/domain/identity/discord.ts";
import {
  ReceiptKindSchema,
  type ReceiptKind,
  type ReceiptScope,
} from "@scout-for-lol/domain/match-processing/states.ts";
import type { MatchProcessingReceiptRecord } from "#src/database/durable/receipt-row.ts";

/**
 * The closed set of receipt kinds the v1 dual-write bridge records, and the
 * versioned evidence each one carries.
 *
 * The domain deliberately leaves {@link ReceiptKindSchema} open — it is a
 * kebab-case brand, not an enum — because receipt kinds belong to the pipeline
 * that produces them, not to the shared contracts. This module is that
 * pipeline's declaration for the effects the per-match flow owns.
 *
 * `raw-archive` and `lake-staging` are deliberately ABSENT. The receipted lake
 * projection owns those two kinds and records them from the writers that
 * actually produce the artifact, which is the only place the object key and
 * content digest exist. Recording them here as well would put two different
 * evidence shapes behind one receipt identity, and the second writer would
 * lose to `receipt-evidence-mismatch`.
 *
 * Evidence identifies what happened by DURABLE identity — Discord message ids,
 * ledger row ids — never by a count, a local path, or a build id, so a reader
 * can go find the thing the receipt attests to. It is also always what the v1
 * call site actually observed; nothing here is reconstructed after the fact.
 * No evidence carries a money amount: the identities are enough to find the
 * ledger rows, and the amounts live there under their own storable brands.
 */

export const MATCH_RECEIPT_KINDS = {
  /** Markets, parlays and Dares settled for the match; balances moved. */
  settlement: ReceiptKindSchema.parse("settlement"),
  /** The visible post-match report reached a guild. */
  reportDelivery: ReceiptKindSchema.parse("report-delivery"),
  /** The pre-match notification reached a guild. */
  prematchDelivery: ReceiptKindSchema.parse("prematch-delivery"),
  /** Competitive progression ran for the match, before cursors advanced. */
  progression: ReceiptKindSchema.parse("progression"),
} as const satisfies Record<string, ReceiptKind>;

/** A BucksBet or BucksDareV2 primary key — the ledger's own row identity. */
const LedgerRowIdSchema = z.int().positive();

/**
 * Settlement evidence names the ledger rows the commit touched, keeping market
 * settlement and Dare resolution apart. They are different products with
 * different semantics — a Dare moves balances between two people, a market
 * settles a pool — and the Scout boundaries forbid collapsing them.
 *
 * Weekly parlays carry no per-bet row id out of the settle call, so they are
 * identified by the guild whose parlay settled; earnings are identified by the
 * account awarded, which together with the receipt's match id names the ledger
 * rows exactly. Every list is sorted and deduplicated so a replay of the same
 * commit produces byte-identical evidence.
 */
export const settlementEvidenceCodec = defineVersionedCodec({
  kind: "settlement-evidence",
  version: 1,
  schema: z.strictObject({
    closedBetIds: z.array(LedgerRowIdSchema),
    settledBetIds: z.array(LedgerRowIdSchema),
    resolvedDareIds: z.array(LedgerRowIdSchema),
    settledParlayGuildIds: z.array(DiscordGuildIdSchema),
    earnedDiscordIds: z.array(DiscordAccountIdSchema),
  }),
});

/**
 * Delivery evidence names the Discord messages that exist because of this
 * match, so the receipt can be checked against Discord itself. Sorted by
 * channel so a replay produces byte-identical evidence.
 */
export const deliveryEvidenceCodec = defineVersionedCodec({
  kind: "delivery-evidence",
  version: 1,
  schema: z.strictObject({
    deliveries: z.array(
      z.strictObject({
        channelId: DiscordChannelIdSchema,
        messageId: DiscordMessageIdSchema,
      }),
    ),
  }),
});

/**
 * The progression stage returns nothing identifying — a challenge-run revision
 * id never leaves `processCompetitiveProgressionMatch` — so this receipt
 * records the shape of the input it ran over rather than inventing an identity
 * for an effect it cannot see.
 */
export const progressionEvidenceCodec = defineVersionedCodec({
  kind: "progression-evidence",
  version: 1,
  schema: z.strictObject({
    participantCount: z.int().nonnegative(),
    trackedAccountCount: z.int().nonnegative(),
  }),
});

export type SettlementEvidence = Parameters<
  typeof settlementEvidenceCodec.serialize
>[0];
export type DeliveryEvidence = Parameters<
  typeof deliveryEvidenceCodec.serialize
>[0];
export type ProgressionEvidence = Parameters<
  typeof progressionEvidenceCodec.serialize
>[0];

/** One delivered Discord message, before it is parsed into evidence. */
export type DeliveredMessage = { channelId: string; messageId: string };

/**
 * Parse and canonicalize a guild's delivered messages. Sorting here rather
 * than at each call site is what makes a replayed delivery's evidence compare
 * equal instead of conflicting.
 */
export function deliveryEvidence(
  delivered: readonly DeliveredMessage[],
): DeliveryEvidence {
  const deliveries = delivered
    .map((entry) => ({
      channelId: DiscordChannelIdSchema.parse(entry.channelId),
      messageId: DiscordMessageIdSchema.parse(entry.messageId),
    }))
    .toSorted((left, right) => left.channelId.localeCompare(right.channelId));
  return { deliveries };
}

/** Sort and deduplicate an identity list so replayed evidence compares equal. */
export function canonicalIdentities<T extends string | number>(
  values: readonly T[],
): T[] {
  return [...new Set(values)].toSorted((left, right) =>
    String(left).localeCompare(String(right)),
  );
}

/**
 * The receipt table's `evidence` column: the codec envelope, serialized. Kept
 * here so every producer writes the same wire form the reader expects.
 */
export function serializeEvidence(envelope: {
  kind: string;
  version: number;
  data: unknown;
}): string {
  return JSON.stringify(envelope);
}

/**
 * Build one receipt record. Every receipt this bridge writes is version 1;
 * the version is part of a receipt's identity, so bumping it is how a future
 * wave records the same fact under a changed meaning without colliding with
 * the rows already stored.
 */
export function buildMatchReceipt(args: {
  matchId: RiotMatchId;
  kind: ReceiptKind;
  scope: ReceiptScope;
  recordedAt: IsoInstant;
  evidence: { kind: string; version: number; data: unknown };
}): MatchProcessingReceiptRecord {
  return {
    matchId: args.matchId,
    receipt: {
      kind: args.kind,
      version: 1,
      scope: args.scope,
      recordedAt: args.recordedAt,
    },
    evidence: serializeEvidence(args.evidence),
  };
}
