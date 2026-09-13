import type {
  RawCurrentGameInfo,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
import type { Db } from "#src/database/index.ts";
import type { ArtifactDescriptor } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import {
  lakeStagingReceiptKind,
  buildReceipt,
  lakeStagingEvidenceCodec,
  prematchReceiptMatchId,
  receiptMatchId,
  recordReceiptFailOpen,
  type LakeStagingEvidence,
  type ReceiptRecordOutcome,
} from "#src/report-lake/durable-receipts.ts";
import {
  matchStagingFilePath,
  matchTeamBanStagingFilePath,
  matchTeamStagingFilePath,
  prematchStagingFilePath,
  timelineStagingFilePath,
  writeMatchStagingFile,
  writePrematchStagingFile,
  writeTimelineStagingFiles,
} from "#src/report-lake/staging.ts";

/**
 * The receipted entry point into lake staging.
 *
 * This is a SECOND door onto the same `write*StagingFile` functions, not a
 * replacement for the first. Rank history and the dev/test no-bucket path still
 * go through the boolean one, and v1's own semantics are unchanged everywhere —
 * best-effort for timeline and prematch; a `false` match staging result still
 * blocks cursor advancement — because the contract that staging must never fail
 * ingest is what makes the nightly rebuild the safety net rather than a second
 * source of truth. Live ingest reaches this door through `report-store/store.ts`,
 * which is where the throw below is turned back into that boolean.
 *
 * What changes on this path is who is allowed to be vague. A caller that asked
 * for a RECEIPTED write is asking for a durable claim that the projection
 * happened, so a failure here throws {@link ReceiptedStagingError} and records
 * nothing. A receipt that might or might not correspond to a real staging file
 * would be worse than no receipt at all: the point of the table is that a row
 * in it can be trusted without re-deriving the fact it attests to.
 */

export class ReceiptedStagingError extends Error {
  readonly objectKind: LakeStagingEvidence["objectKind"];
  readonly matchId: string;

  constructor(args: {
    objectKind: LakeStagingEvidence["objectKind"];
    matchId: string;
  }) {
    super(
      `Report lake staging failed for ${args.objectKind} ${args.matchId}; no receipt was recorded.`,
    );
    this.name = "ReceiptedStagingError";
    this.objectKind = args.objectKind;
    this.matchId = args.matchId;
  }
}

export type ReceiptedStagingResult = {
  /**
   * Absolute paths of the staging files this run wrote, for the immediate
   * caller's own logging. They are deliberately NOT in the receipt: they name
   * a location on one role's RWO volume, and a receipt has to stay true for
   * readers that cannot see it.
   */
  files: readonly string[];
  /**
   * What the durable recorder said. `failed` means the staging files exist but
   * the durable record of them does not; `conflict` means a receipt for this
   * identity already exists carrying different evidence. Either way the staging
   * files are written and the caller has succeeded.
   */
  receipt: ReceiptRecordOutcome;
};

type ReceiptOptions = {
  /**
   * The archived S3 object these staging rows were derived from. Required,
   * because a staging receipt that could not name its source would be a claim
   * about a filesystem rather than about the data.
   */
  source: ArtifactDescriptor;
  /** Supply a transaction client to record the receipt atomically with others. */
  db?: Db;
  /** Injectable so tests need no wall clock; defaults to now. */
  now?: Date;
};

async function receiptStagedFiles(args: {
  objectKind: LakeStagingEvidence["objectKind"];
  matchId: string;
  staged: boolean;
  files: readonly string[];
  options: ReceiptOptions;
}): Promise<ReceiptedStagingResult> {
  if (!args.staged) {
    throw new ReceiptedStagingError({
      objectKind: args.objectKind,
      matchId: args.matchId,
    });
  }
  if (args.options.source.kind !== args.objectKind) {
    throw new Error(
      `Refusing to receipt ${args.objectKind} staging for ${args.matchId} against a ${args.options.source.kind} artifact: the source descriptor does not describe what was staged`,
    );
  }
  const evidence = lakeStagingEvidenceCodec.serialize({
    objectKind: args.objectKind,
    sourceObjectKey: args.options.source.key,
    digest: args.options.source.digest,
    fileCount: args.files.length,
  });
  const receipt = await recordReceiptFailOpen({
    record: buildReceipt({
      matchId: receiptMatchId(args.matchId),
      kind: lakeStagingReceiptKind(args.objectKind),
      evidence,
      recordedAt: args.options.now ?? new Date(),
    }),
    writeKind: "lake-staging",
    ...(args.options.db === undefined ? {} : { db: args.options.db }),
  });
  return { files: args.files, receipt };
}

export async function stageMatchReceipted(
  lakeDir: string,
  match: RawMatch,
  options: ReceiptOptions,
): Promise<ReceiptedStagingResult> {
  const matchId = match.metadata.matchId;
  const staged = await writeMatchStagingFile(lakeDir, match);
  return receiptStagedFiles({
    objectKind: "match",
    matchId,
    staged,
    files: [
      matchStagingFilePath(lakeDir, matchId),
      matchTeamStagingFilePath(lakeDir, matchId),
      matchTeamBanStagingFilePath(lakeDir, matchId),
    ],
    options,
  });
}

export async function stageTimelineReceipted(
  lakeDir: string,
  timeline: RawTimeline,
  observedAt: Date,
  options: ReceiptOptions,
): Promise<ReceiptedStagingResult> {
  const matchId = timeline.metadata.matchId;
  const staged = await writeTimelineStagingFiles(lakeDir, timeline, observedAt);
  return receiptStagedFiles({
    objectKind: "timeline",
    matchId,
    staged,
    // Every timeline table is listed, including any the flattener emitted no
    // rows for. The receipt describes the projection this capture defines, and
    // "this match produced no events" is part of that projection, not a gap.
    files: [
      timelineStagingFilePath(lakeDir, "timeline_events", matchId),
      timelineStagingFilePath(lakeDir, "timeline_event_participants", matchId),
      timelineStagingFilePath(lakeDir, "timeline_participant_frames", matchId),
      timelineStagingFilePath(lakeDir, "timeline_coverage", matchId),
    ],
    options,
  });
}

export async function stagePrematchReceipted(
  lakeDir: string,
  gameInfo: RawCurrentGameInfo,
  observedAt: Date,
  options: ReceiptOptions,
): Promise<ReceiptedStagingResult> {
  const dedupeKey = `${gameInfo.platformId}:${gameInfo.gameId.toString()}`;
  const staged = await writePrematchStagingFile(lakeDir, gameInfo, observedAt);
  return receiptStagedFiles({
    objectKind: "prematch",
    matchId: prematchReceiptMatchId(gameInfo),
    staged,
    files: [prematchStagingFilePath(lakeDir, dedupeKey)],
    options,
  });
}
