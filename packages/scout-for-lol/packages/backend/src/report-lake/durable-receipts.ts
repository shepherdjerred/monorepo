import { z } from "zod";
import type { Db } from "#src/database/index.ts";
import { prisma } from "#src/database/index.ts";
import {
  listReceipts,
  recordReceipt,
} from "#src/database/durable/receipt-repository.ts";
import type { MatchProcessingReceiptRecord } from "#src/database/durable/receipt-row.ts";
import { createLogger } from "#src/logger.ts";
import {
  countDurableWrite,
  countDurableWriteFailure,
  insideDurableWrite,
  type DurableWriteKind,
} from "#src/durable/match/durable-facts.ts";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import {
  ArtifactDescriptorSchema,
  type ArtifactDescriptor,
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
import { prematchObjectResourceId } from "#src/storage/s3-prematch.ts";

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

/**
 * What a raw-archive receipt attests to: the artifact's IDENTITY, and nothing
 * observational.
 *
 * Version 1 of this evidence was the whole `ArtifactDescriptor`, `capturedAt`
 * included. That put a wall-clock instant inside the replay identity — the
 * third instance of the class `recordReceipt`'s doc describes for
 * `recordedAt` — so two attestations of byte-identical bytes disagreed about
 * the fact whenever they were stamped a millisecond apart. Version 2 carries
 * the content-addressed identity only: kind, key, digest, byte count and
 * content type are true of the object from anywhere; the capture instant is
 * true only of the attempt that captured it.
 *
 * The capture instant is not lost: a version-2 receipt records it as the
 * receipt's own `recordedAt`, which is exactly the slot the domain reserves
 * for observational metadata of the first attestation. {@link rawArchiveDescriptorOf}
 * puts the two halves back together.
 *
 * Beta and production hold version-1 rows. They are not reinterpreted: the
 * migration validates a version-1 payload against the version-1 shape before
 * narrowing it, and a version-1 row's capture instant is still read from its
 * own evidence rather than from a column that meant something slightly
 * different when it was written.
 */
export type RawArchiveEvidence = z.infer<typeof RawArchiveEvidenceSchema>;
export const RawArchiveEvidenceSchema = ArtifactDescriptorSchema.omit({
  capturedAt: true,
});

/** The evidence shape version-1 rows were written with. */
const RawArchiveEvidenceV1Schema = ArtifactDescriptorSchema;

export const RAW_ARCHIVE_EVIDENCE_VERSION = 2;
/** The last version whose evidence carried the capture instant itself. */
const RAW_ARCHIVE_EVIDENCE_CAPTURE_IN_EVIDENCE_VERSION = 1;

export const rawArchiveEvidenceCodec = defineVersionedCodec({
  kind: "raw-archive-evidence",
  version: RAW_ARCHIVE_EVIDENCE_VERSION,
  schema: RawArchiveEvidenceSchema,
  migrations: {
    1: (old) => rawArchiveEvidenceOf(RawArchiveEvidenceV1Schema.parse(old)),
  },
});

/** The attestable part of a descriptor: everything but the capture instant. */
export function rawArchiveEvidenceOf(
  artifact: ArtifactDescriptor,
): RawArchiveEvidence {
  const { capturedAt: _capturedAt, ...identity } = artifact;
  return RawArchiveEvidenceSchema.parse(identity);
}

/**
 * The receipt that attests one archived artifact.
 *
 * `recordedAt` IS the capture instant, by construction rather than by
 * coincidence: the descriptor's `capturedAt` is what the put stamped, and the
 * receipt's observational column is where a version-2 row keeps it, so the
 * descriptor a reader rebuilds is the descriptor the writer was handed.
 */
export function rawArchiveReceiptRecord(args: {
  matchId: RiotMatchId;
  artifact: ArtifactDescriptor;
}): MatchProcessingReceiptRecord {
  return buildReceipt({
    matchId: args.matchId,
    kind: rawArchiveReceiptKind(args.artifact.kind),
    evidence: rawArchiveEvidenceCodec.serialize(
      rawArchiveEvidenceOf(args.artifact),
    ),
    recordedAt: new Date(args.artifact.capturedAt),
  });
}

/** Only the envelope's version, read without committing to any payload shape. */
const EvidenceEnvelopeVersionSchema = z.object({
  version: z.number().int(),
  data: z.unknown(),
});

/**
 * The descriptor a raw-archive receipt attests to, capture instant included.
 *
 * Which column holds the capture instant depends on the version the row was
 * WRITTEN at, and that decision is made here once rather than at every reader.
 * A version-1 row's evidence carries it, and is read as version 1 says; a
 * later row carries it as `recordedAt`. Neither is a fallback for the other —
 * each version's rows are read the way that version wrote them.
 */
export function rawArchiveDescriptorOf(
  record: MatchProcessingReceiptRecord,
): ArtifactDescriptor {
  if (record.evidence == null) {
    throw new Error(
      `Raw-archive receipt ${record.receipt.kind} for ${record.matchId} carries no evidence, so it names no artifact`,
    );
  }
  const envelope: unknown = JSON.parse(record.evidence);
  const identity = rawArchiveEvidenceCodec.parse(envelope);
  const { version, data } = EvidenceEnvelopeVersionSchema.parse(envelope);
  const capturedAt =
    version === RAW_ARCHIVE_EVIDENCE_CAPTURE_IN_EVIDENCE_VERSION
      ? RawArchiveEvidenceV1Schema.parse(data).capturedAt
      : record.receipt.recordedAt;
  return ArtifactDescriptorSchema.parse({ ...identity, capturedAt });
}

/**
 * The Riot match id a prematch snapshot will belong to.
 *
 * Receipts are keyed by match id, and a spectator snapshot is captured before
 * MatchV5 knows about the game — but the id is not unknown, it is simply not
 * assembled yet: Riot builds it from exactly the platform and game id the
 * spectator payload already carries. It is the same string the S3 object is
 * keyed under, so the object, the fence and the receipt share one identity.
 */
export function prematchReceiptMatchId(
  gameInfo: RawCurrentGameInfo,
): RiotMatchId {
  return receiptMatchId(
    prematchObjectResourceId(gameInfo.platformId, gameInfo.gameId),
  );
}

export function receiptMatchId(matchId: string): RiotMatchId {
  return RiotMatchIdSchema.parse(matchId);
}

/**
 * The descriptor of an artifact this pipeline already archived, read back from
 * its own raw-archive receipt.
 *
 * The receipt is the hand-off between writers that cannot share memory: a
 * raw-archive receipt names the `ArtifactDescriptor` (see
 * {@link rawArchiveDescriptorOf}), so a later pass reports the identity the
 * pass that archived it recorded, rather than reconstructing a key from the
 * layout convention — which would be evidence of nothing.
 *
 * It lives here, beside the receipt kind and the evidence codec it is built
 * from, because two callers need the same answer: the archive door gates its
 * put on it, and the V2 capture reports it.
 */
export async function storedRawArchiveDescriptor(
  db: Db,
  matchId: RiotMatchId,
  artifact: ArtifactKind,
): Promise<ArtifactDescriptor | null> {
  const kind = rawArchiveReceiptKind(artifact);
  const receipts = await listReceipts(db, { matchId });
  const archived = receipts.find((record) => record.receipt.kind === kind);
  return archived === undefined ? null : rawArchiveDescriptorOf(archived);
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
 * makes either usable. The failures counter counts only THROWN writes — the
 * recorder itself is broken and the stored state is unknown, which is worth
 * paging on. The records counter counts every completed write by its repository
 * outcome, so a `conflict` stays visible as drift without contaminating the
 * alert.
 *
 * Conflicts are a permanent feature of this table, not a transitional one: a
 * producer whose v1 operation is one-shot genuinely observes different evidence
 * on a replay, and reporting that honestly is better than fabricating agreement.
 * So a `conflict` must never reach the failures counter, whatever the
 * repository's replay equality happens to compare at the time.
 *
 * Both counters are reached through `durable-facts.ts` rather than incremented
 * here: `write_kind` comes from the one closed set, and the repository's answer
 * is parsed before it becomes a label, so this producer cannot widen either
 * axis of a metric the other producer shares.
 */
export async function recordReceiptFailOpen(args: {
  record: MatchProcessingReceiptRecord;
  writeKind: DurableWriteKind;
  db?: Db;
}): Promise<ReceiptRecordOutcome> {
  if (insideDurableWrite()) {
    // Both wrappers count a completed write, so nesting them would record one
    // fact twice. The receipted doors run alongside the durable services, never
    // inside them; a caller that nests them is a bug, not a degraded mode.
    throw new Error(
      `Refusing to record the ${args.record.receipt.kind} receipt for ${args.record.matchId} from inside a durable write: it would double-count scout_durable_dualwrite_records_total`,
    );
  }
  try {
    const result = await recordReceipt(args.db ?? prisma, args.record);
    countDurableWrite(args.writeKind, result.outcome);
    if (result.outcome === "conflict") {
      logger.warn(
        `Receipt ${args.record.receipt.kind} for ${args.record.matchId} disagrees with the recorded one (${result.reason}); the first writer's evidence stands`,
      );
      return "conflict";
    }
    return "recorded";
  } catch (error) {
    logger.error(
      `Failed to record ${args.record.receipt.kind} receipt for ${args.record.matchId}; the v1 write stands`,
      error,
    );
    countDurableWriteFailure(args.writeKind);
    return "failed";
  }
}
