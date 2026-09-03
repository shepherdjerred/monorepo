import type {
  RawCurrentGameInfo,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  writeMatchStagingFile,
  writePrematchStagingFile,
  writeTimelineStagingFiles,
} from "#src/report-lake/staging.ts";
import {
  saveMatchToS3,
  savePrematchDataToS3,
  saveTimelineToS3,
} from "#src/storage/s3.ts";

/**
 * S3-authoritative ingest. S3 (SeaweedFS) is the canonical raw store — the
 * report lake rebuilds by enumerating it — so the S3 write is the must-succeed
 * step and throws on failure. The lake staging write is best-effort by design
 * (it logs + meters internally, never throws) since the compactor re-derives
 * the same rows from S3.
 *
 * No SQLite match/prematch/timeline/fact writes happen here anymore; the
 * Stored and fact tables are unwritten (dropped in the follow-up PR).
 */

export async function ingestMatch(
  match: RawMatch,
  trackedPlayerAliases: string[],
): Promise<{ staged: boolean; stored: boolean }> {
  // Authoritative: throws on failure.
  const storageStatus = await saveMatchToS3(match, trackedPlayerAliases);
  // Best-effort lake staging so the DuckDB report engine sees this match
  // before the next compaction; never throws.
  const staged = await writeMatchStagingFile(resolveLakeDir(), match);
  return { staged, stored: storageStatus === "saved" };
}

export async function ingestTimeline(
  timeline: RawTimeline,
  trackedPlayerAliases: string[],
): Promise<void> {
  await saveTimelineToS3(timeline, trackedPlayerAliases);
  const staged = await writeTimelineStagingFiles(
    resolveLakeDir(),
    timeline,
    new Date(),
  );
  if (!staged) {
    throw new Error(
      `Timeline ${timeline.metadata.matchId} could not be staged in the report lake.`,
    );
  }
}

export async function ingestPrematch(
  gameInfo: RawCurrentGameInfo,
  observedAt: Date,
  trackedPlayerAliases: string[],
): Promise<void> {
  // Authoritative: throws on failure (missing bucket is a graceful no-op).
  await savePrematchDataToS3(gameInfo.gameId, gameInfo, trackedPlayerAliases);
  // Best-effort lake staging; never throws.
  await writePrematchStagingFile(resolveLakeDir(), gameInfo, observedAt);
}
