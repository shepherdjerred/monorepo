import type {
  RawCurrentGameInfo,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  writeMatchStagingFile,
  writePrematchStagingFile,
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
): Promise<void> {
  // Authoritative: throws on failure.
  await saveMatchToS3(match, trackedPlayerAliases);
  // Best-effort lake staging so the DuckDB report engine sees this match
  // before the next compaction; never throws.
  await writeMatchStagingFile(resolveLakeDir(), match);
}

export async function ingestTimeline(
  timeline: RawTimeline,
  trackedPlayerAliases: string[],
): Promise<void> {
  // Timelines have no lake reader, so there is no staging step.
  await saveTimelineToS3(timeline, trackedPlayerAliases);
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
