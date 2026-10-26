import type { MatchProcessingReceiptRecord } from "#src/database/durable/receipt-row.ts";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import type {
  IsoInstant,
  RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/domain/identity/discord.ts";
import {
  ReceiptKindSchema,
  type ReceiptKind,
  type ReceiptScope,
} from "@scout-for-lol/domain/match-processing/states.ts";
import { z } from "zod";

/**
 * The closed set of per-match receipt kinds, and the versioned evidence each
 * one carries.
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
 * Dare ids — never by a count, a local path, or a build id, so a reader
 * can go find the thing the receipt attests to. It is also always what the v1
 * call site actually observed; nothing here is reconstructed after the fact.
 */

export const MATCH_RECEIPT_KINDS = {
  /** Dare resolution completed for the match; the receipt kind is stable. */
  settlement: ReceiptKindSchema.parse("settlement"),
  /** The visible post-match report reached a guild. */
  reportDelivery: ReceiptKindSchema.parse("report-delivery"),
  /** The pre-match notification reached a guild. */
  prematchDelivery: ReceiptKindSchema.parse("prematch-delivery"),
  /** Competitive progression ran for the match, before cursors advanced. */
  progression: ReceiptKindSchema.parse("progression"),
} as const satisfies Record<string, ReceiptKind>;

/** A database row identity, including retained settlement receipt IDs. */
const DatabaseRowIdSchema = z.int().positive();

const LegacySettlementEvidenceSchema = z.strictObject({
  closedBetIds: z.array(DatabaseRowIdSchema),
  settledBetIds: z.array(DatabaseRowIdSchema),
  resolvedDareIds: z.array(DatabaseRowIdSchema),
  settledParlayGuildIds: z.array(DiscordGuildIdSchema),
  earnedDiscordIds: z.array(DiscordAccountIdSchema),
});
export const settlementEvidenceCodec = defineVersionedCodec({
  kind: "settlement-evidence",
  version: 2,
  schema: z.strictObject({ resolvedDareIds: z.array(DatabaseRowIdSchema) }),
  migrations: {
    1: (old) => ({
      resolvedDareIds:
        LegacySettlementEvidenceSchema.parse(old).resolvedDareIds,
    }),
  },
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
