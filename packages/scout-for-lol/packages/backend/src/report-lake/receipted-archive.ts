import type {
  RawCurrentGameInfo,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
import type { Db } from "#src/database/index.ts";
import type { ArtifactDescriptor } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import {
  rawArchiveReceiptKind,
  buildReceipt,
  prematchReceiptMatchId,
  rawArchiveEvidenceCodec,
  receiptMatchId,
  recordReceiptFailOpen,
  type ReceiptRecordOutcome,
} from "#src/report-lake/durable-receipts.ts";
import {
  archiveMatchToS3,
  archiveTimelineToS3,
  savePrematchDataToS3,
} from "#src/storage/s3.ts";

/**
 * The receipted entry point into raw S3 archival.
 *
 * S3 is the canonical raw store, so these functions do not soften the archive
 * itself: a failed put throws exactly as it did before, and no receipt is
 * written for an object that does not exist. What they add is the durable claim
 * — the descriptor of what was stored, content-addressed by the digest of the
 * exact bytes uploaded, recorded against the match the capture belongs to.
 *
 * The receipt write is the one part that is fail-open, and deliberately so; see
 * `recordReceiptFailOpen`. The no-bucket path stays the dev/test no-op it has
 * always been, and records nothing, because nothing was archived.
 *
 * These live under `report-lake/` rather than `storage/` for an architectural
 * reason: `architecture.config.ts` forbids `storage/` and `report-store/` from
 * importing `database/`, since a persistence adapter that reaches into another
 * one cannot be used from a script or a fixture without dragging it along. The
 * lake layer is already the one that composes the object store, the staging
 * files and the database, so the composition belongs here.
 */

export type ReceiptedArchiveResult =
  | {
      status: "archived";
      artifact: ArtifactDescriptor;
      /**
       * What the durable recorder said. `failed` means the object is in S3 but
       * the durable record of it is not; `conflict` means a receipt for this
       * identity already exists carrying different evidence. Either way the
       * object is archived and the caller has succeeded.
       */
      receipt: ReceiptRecordOutcome;
    }
  | { status: "skipped_no_bucket" };

type ReceiptOptions = {
  /** Supply a transaction client to record the receipt atomically with others. */
  db?: Db;
  /** Injectable so tests need no wall clock; defaults to now. */
  now?: Date;
};

async function receiptArchived(args: {
  matchId: string;
  artifact: ArtifactDescriptor;
  options: ReceiptOptions;
}): Promise<ReceiptedArchiveResult> {
  const receipt = await recordReceiptFailOpen({
    record: buildReceipt({
      matchId: receiptMatchId(args.matchId),
      kind: rawArchiveReceiptKind(args.artifact.kind),
      evidence: rawArchiveEvidenceCodec.serialize(args.artifact),
      recordedAt: args.options.now ?? new Date(),
    }),
    writeKind: "raw-archive",
    ...(args.options.db === undefined ? {} : { db: args.options.db }),
  });
  return { status: "archived", artifact: args.artifact, receipt };
}

export async function archiveMatchReceipted(
  match: RawMatch,
  trackedPlayerAliases: string[],
  options: ReceiptOptions = {},
): Promise<ReceiptedArchiveResult> {
  const result = await archiveMatchToS3(match, trackedPlayerAliases);
  if (result.status === "skipped_no_bucket") {
    return { status: "skipped_no_bucket" };
  }
  return receiptArchived({
    matchId: match.metadata.matchId,
    artifact: result.artifact,
    options,
  });
}

export async function archiveTimelineReceipted(
  timeline: RawTimeline,
  trackedPlayerAliases: string[],
  gameCreatedAt: Date,
  options: ReceiptOptions = {},
): Promise<ReceiptedArchiveResult> {
  const result = await archiveTimelineToS3(
    timeline,
    trackedPlayerAliases,
    gameCreatedAt,
  );
  if (result.status === "skipped_no_bucket") {
    return { status: "skipped_no_bucket" };
  }
  return receiptArchived({
    matchId: timeline.metadata.matchId,
    artifact: result.artifact,
    options,
  });
}

export async function archivePrematchReceipted(
  gameInfo: RawCurrentGameInfo,
  trackedPlayerAliases: string[],
  options: ReceiptOptions = {},
): Promise<ReceiptedArchiveResult> {
  const result = await savePrematchDataToS3(
    gameInfo.gameId,
    gameInfo,
    trackedPlayerAliases,
  );
  if (result.status === "skipped_no_bucket" || result.artifact === undefined) {
    return { status: "skipped_no_bucket" };
  }
  return receiptArchived({
    matchId: prematchReceiptMatchId(gameInfo),
    artifact: result.artifact,
    options,
  });
}
