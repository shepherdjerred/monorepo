import type {
  RawCurrentGameInfo,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
import type { ArtifactDescriptor } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  archiveMatchReceipted,
  archivePrematchReceipted,
  archiveTimelineReceipted,
} from "#src/report-lake/receipted-archive.ts";
import {
  ReceiptedStagingError,
  stageMatchReceipted,
  stagePrematchReceipted,
  stageTimelineReceipted,
  type ReceiptedStagingResult,
} from "#src/report-lake/receipted-staging.ts";
import {
  writeMatchStagingFile,
  writePrematchStagingFile,
  writeTimelineStagingFiles,
} from "#src/report-lake/staging.ts";

/**
 * S3-authoritative ingest. S3 (SeaweedFS) is the canonical raw store — the
 * report lake rebuilds by enumerating it — so the S3 write is the must-succeed
 * step and throws on failure. The lake staging write is best-effort by design
 * since the compactor re-derives the same rows from S3.
 *
 * Both steps run through the receipted doors in `report-lake/`, so an ingest
 * leaves durable evidence of what it archived and what it projected. That is
 * the only thing that changed here: the receipted doors are the same archival
 * and staging primitives with a stricter contract on top, and this module is
 * where that contract is translated back into v1's.
 *
 * No SQLite match/prematch/timeline/fact writes happen here anymore; the
 * Stored and fact tables are unwritten (dropped in the follow-up PR).
 */

/**
 * What one match ingest did.
 *
 * `artifact` is the raw payload's durable identity — the key the put actually
 * used and the digest of the exact bytes uploaded. It is present exactly when
 * the canonical write happened, so the dual-write layer above can stamp the
 * observation's artifact columns with an identity rather than reconstruct one
 * from the key layout, which would be evidence of nothing.
 */
export type MatchIngestResult = {
  staged: boolean;
  stored: boolean;
  artifact?: ArtifactDescriptor;
};

/**
 * Run a receipted staging write and answer in v1's boolean.
 *
 * THIS IS WHERE THE TWO CONTRACTS MEET. The receipted door throws when the
 * projection fails, because a caller asking for a durable claim must never get
 * a receipt for staging files that do not exist. v1's callers decide something
 * different with the same answer — a `false` match staging result blocks cursor
 * advancement, while timeline and prematch staging are best-effort — and this
 * wave must not change any of that, so the one failure the receipted door
 * signals by throwing becomes the `false` it has always been.
 *
 * Only {@link ReceiptedStagingError} is translated. A source descriptor that
 * does not describe what was staged is a broken internal contract, not a failed
 * projection, and stays fatal.
 */
async function stagedForV1(
  stage: () => Promise<ReceiptedStagingResult>,
): Promise<boolean> {
  try {
    await stage();
    return true;
  } catch (error) {
    if (error instanceof ReceiptedStagingError) {
      return false;
    }
    throw error;
  }
}

/**
 * The dev/test no-bucket path stages through the unreceipted door on purpose.
 * A lake-staging receipt identifies the projection by the S3 object its rows
 * were derived from, and when nothing was archived there is no such object —
 * so there is no honest claim to record, exactly as the archive itself records
 * nothing.
 */
export async function ingestMatch(
  match: RawMatch,
  trackedPlayerAliases: string[],
): Promise<MatchIngestResult> {
  // Authoritative: throws on failure.
  const archived = await archiveMatchReceipted(match, trackedPlayerAliases);
  if (archived.status === "skipped_no_bucket") {
    return {
      staged: await writeMatchStagingFile(resolveLakeDir(), match),
      stored: false,
    };
  }
  // Lake staging so the DuckDB report engine sees this match before the next
  // compaction; a failure is reported, never thrown.
  const staged = await stagedForV1(() =>
    stageMatchReceipted(resolveLakeDir(), match, { source: archived.artifact }),
  );
  return { staged, stored: true, artifact: archived.artifact };
}

export async function ingestTimeline(
  timeline: RawTimeline,
  trackedPlayerAliases: string[],
  gameCreatedAt: Date,
): Promise<boolean> {
  const archived = await archiveTimelineReceipted(
    timeline,
    trackedPlayerAliases,
    gameCreatedAt,
  );
  const lakeDir = resolveLakeDir();
  if (archived.status === "skipped_no_bucket") {
    return await writeTimelineStagingFiles(lakeDir, timeline, new Date());
  }
  return await stagedForV1(() =>
    stageTimelineReceipted(lakeDir, timeline, new Date(), {
      source: archived.artifact,
    }),
  );
}

export async function ingestPrematch(
  gameInfo: RawCurrentGameInfo,
  observedAt: Date,
  trackedPlayerAliases: string[],
): Promise<void> {
  // Authoritative: throws on failure (missing bucket is a graceful no-op).
  const archived = await archivePrematchReceipted(
    gameInfo,
    trackedPlayerAliases,
  );
  const lakeDir = resolveLakeDir();
  if (archived.status === "skipped_no_bucket") {
    await writePrematchStagingFile(lakeDir, gameInfo, observedAt);
    return;
  }
  await stagedForV1(() =>
    stagePrematchReceipted(lakeDir, gameInfo, observedAt, {
      source: archived.artifact,
    }),
  );
}
