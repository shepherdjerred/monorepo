import { z } from "zod";
import type { Db } from "#src/database/index.ts";
import { prisma } from "#src/database/index.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
import type { MatchProcessingReceiptRecord } from "#src/database/durable/receipt-row.ts";
import { createLogger } from "#src/logger.ts";
import {
  scoutDurableDualwriteFailuresTotal,
  scoutDurableDualwriteRecordsTotal,
} from "#src/metrics/durable.ts";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import {
  ArtifactDescriptorSchema,
  type ArtifactKind,
} from "@scout-for-lol/domain/artifacts/descriptors.ts";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  ReceiptKindSchema,
  type ReceiptKind,
} from "@scout-for-lol/domain/match-processing/states.ts";
import type { RawCurrentGameInfo } from "@scout-for-lol/data";

const logger = createLogger("report-lake-durable-receipts");

/**
 * Receipt plumbing shared by the receipted staging and archive entry points.
 *
 * A receipt is the durable answer to "did this actually happen?", so its
 * evidence has to survive a schema change as well as the fact does. Both kinds
 * therefore serialize through a versioned envelope rather than raw JSON: a
 * reader that meets a version it cannot migrate rejects it loudly instead of
 * silently reading the wrong shape.
 *
 * The domain deliberately does not enumerate receipt kinds — they belong to the
 * workflows that emit them — so the kinds this feature owns are named here.
 */

/**
 * Receipt kinds are per ARTIFACT KIND, not per family.
 *
 * A receipt's identity is `(kind, version, scope)` within one match, and all
 * three artifacts of a game share that match id — a prematch snapshot is keyed
 * by the very id MatchV5 later assigns. So a single `raw-archive` kind would
 * make the match, its timeline and its prematch snapshot the SAME receipt:
 * archiving the timeline after the match would not record a second fact, it
 * would collide with the first and be reported as a conflict. A normal ingest
 * could never receipt all of its inputs.
 *
 * Splitting the kind is what makes them distinct facts. `ReceiptKind` is a
 * branded kebab-case string precisely so waves can name their own kinds, and
 * "the match payload was archived" genuinely is a different claim from "its
 * timeline was archived". The evidence codecs stay shared across each family:
 * the shape of the claim does not change with the artifact it describes.
 */
const RAW_ARCHIVE_RECEIPT_KINDS = {
  match: ReceiptKindSchema.parse("raw-archive-match"),
  timeline: ReceiptKindSchema.parse("raw-archive-timeline"),
  prematch: ReceiptKindSchema.parse("raw-archive-prematch"),
} as const satisfies Record<ArtifactKind, ReceiptKind>;

const LAKE_STAGING_RECEIPT_KINDS = {
  match: ReceiptKindSchema.parse("lake-staging-match"),
  timeline: ReceiptKindSchema.parse("lake-staging-timeline"),
  prematch: ReceiptKindSchema.parse("lake-staging-prematch"),
} as const satisfies Record<ArtifactKind, ReceiptKind>;

/** The canonical object store holds this artifact. */
export function rawArchiveReceiptKind(artifact: ArtifactKind): ReceiptKind {
  return RAW_ARCHIVE_RECEIPT_KINDS[artifact];
}

/** The lake projection for this artifact reached its staging files. */
export function lakeStagingReceiptKind(artifact: ArtifactKind): ReceiptKind {
  return LAKE_STAGING_RECEIPT_KINDS[artifact];
}

/** Every receipt kind this feature owns, for cross-checking against others. */
export const RECEIPTED_LAKE_RECEIPT_KINDS: readonly ReceiptKind[] = [
  ...Object.values(RAW_ARCHIVE_RECEIPT_KINDS),
  ...Object.values(LAKE_STAGING_RECEIPT_KINDS),
];

export const RECEIPT_VERSION = 1;

/**
 * What a lake-staging receipt attests to, identified by CONTENT rather than by
 * location.
 *
 * The staging files themselves live on a role's own RWO volume, so their
 * absolute paths are meaningless to any other role and would be meaningless to
 * every role if the lake ever moved to a shared store. A receipt that named
 * them would be a claim no reader could evaluate. Instead the evidence names
 * the S3 object the rows were derived from and the digest of the exact bytes
 * that produced them: both are true from anywhere, and together they let a
 * reader re-derive the projection and check it.
 *
 * `fileCount` is the shape of the projection — how many staging relations this
 * capture writes — which is a property of the capture, not of a filesystem.
 */
export type LakeStagingEvidence = z.infer<typeof LakeStagingEvidenceSchema>;
export const LakeStagingEvidenceSchema = z.strictObject({
  objectKind: ArtifactDescriptorSchema.shape.kind,
  sourceObjectKey: ArtifactDescriptorSchema.shape.key,
  digest: ArtifactDescriptorSchema.shape.digest,
  fileCount: z.number().int().positive(),
});

export const lakeStagingEvidenceCodec = defineVersionedCodec({
  kind: "lake-staging-evidence",
  version: RECEIPT_VERSION,
  schema: LakeStagingEvidenceSchema,
});

export const rawArchiveEvidenceCodec = defineVersionedCodec({
  kind: "raw-archive-evidence",
  version: RECEIPT_VERSION,
  schema: ArtifactDescriptorSchema,
});

/**
 * The Riot match id a prematch snapshot will belong to.
 *
 * Receipts are keyed by match id, and a spectator snapshot is captured before
 * MatchV5 knows about the game — but the id is not unknown, it is simply not
 * assembled yet: Riot builds it from exactly the platform and game id the
 * spectator payload already carries.
 */
export function prematchReceiptMatchId(
  gameInfo: RawCurrentGameInfo,
): RiotMatchId {
  return receiptMatchId(`${gameInfo.platformId}_${gameInfo.gameId.toString()}`);
}

export function receiptMatchId(matchId: string): RiotMatchId {
  return RiotMatchIdSchema.parse(matchId);
}

export function buildReceipt(args: {
  matchId: RiotMatchId;
  kind: ReceiptKind;
  evidence: unknown;
  recordedAt: Date;
}): MatchProcessingReceiptRecord {
  return {
    matchId: args.matchId,
    receipt: {
      kind: args.kind,
      version: RECEIPT_VERSION,
      scope: { kind: "global" },
      recordedAt: IsoInstantSchema.parse(args.recordedAt.toISOString()),
    },
    evidence: JSON.stringify(args.evidence),
  };
}

/**
 * What the durable recorder was able to say about this fact.
 *
 * `conflict` is deliberately NOT collapsed into `failed`. They are different
 * operational conditions: `failed` means the write did not happen and the
 * stored state is unknown, while `conflict` is a definite answer from a
 * successful write — the row is there, the first writer's evidence was kept,
 * and two producers disagree about the fact.
 */
export type ReceiptRecordOutcome = "recorded" | "conflict" | "failed";

/**
 * Record a receipt without letting its failure fail the write it describes.
 *
 * The v1 archive and staging paths are the ones with user-visible consequences:
 * refusing an archive because the row recording it could not be inserted trades
 * a bookkeeping problem for a data-loss one. So a broken receipt write is logged
 * and metered and nothing else.
 *
 * The two counters answer different questions, and keeping them apart is what
 * makes either usable. {@link scoutDurableDualwriteFailuresTotal} counts only
 * THROWN writes — the recorder itself is broken and the stored state is unknown,
 * which is worth paging on. {@link scoutDurableDualwriteRecordsTotal} counts
 * every completed write by its repository outcome, so a `conflict` stays visible
 * as drift without contaminating the alert.
 *
 * Conflicts are a permanent feature of this table, not a transitional one: a
 * producer whose v1 operation is one-shot genuinely observes different evidence
 * on a replay, and reporting that honestly is better than fabricating agreement.
 * So a `conflict` must never reach the failures counter, whatever the
 * repository's replay equality happens to compare at the time.
 */
export async function recordReceiptFailOpen(args: {
  record: MatchProcessingReceiptRecord;
  writeKind: string;
  db?: Db;
}): Promise<ReceiptRecordOutcome> {
  try {
    const outcome = await recordReceipt(args.db ?? prisma, args.record);
    scoutDurableDualwriteRecordsTotal.inc({
      write_kind: args.writeKind,
      outcome: outcome.outcome,
    });
    if (outcome.outcome === "conflict") {
      logger.warn(
        `Receipt ${args.record.receipt.kind} for ${args.record.matchId} disagrees with the recorded one (${outcome.reason}); the first writer's evidence stands`,
      );
      return "conflict";
    }
    return "recorded";
  } catch (error) {
    logger.error(
      `Failed to record ${args.record.receipt.kind} receipt for ${args.record.matchId}; the v1 write stands`,
      error,
    );
    scoutDurableDualwriteFailuresTotal.inc({ write_kind: args.writeKind });
    return "failed";
  }
}
