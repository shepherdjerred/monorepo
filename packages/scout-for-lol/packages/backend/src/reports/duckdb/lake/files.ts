import type { CrawlLakeFiles } from "#src/reports/duckdb/lake/crawl-files.ts";

/** Paths captured together for one report-lake query attempt. */
export type LakeFiles = {
  matchesParquet: string[];
  matchesStaging: string[];
  matchTeamsParquet: string[];
  matchTeamsStaging: string[];
  matchTeamBansParquet: string[];
  matchTeamBansStaging: string[];
  prematchParquet: string[];
  prematchStaging: string[];
  accountsParquet: string | undefined;
  competitionRankHistoryParquet: string[];
  competitionRankHistoryStaging: string[];
  timelineEventsParquet: string[];
  timelineEventsStaging: string[];
  timelineEventParticipantsParquet: string[];
  timelineEventParticipantsStaging: string[];
  timelineParticipantFramesParquet: string[];
  timelineParticipantFramesStaging: string[];
  timelineCoverageParquet: string[];
  timelineCoverageStaging: string[];
  /** The crawl tables of the same build; read only by the `all` population. */
  crawl: CrawlLakeFiles;
  /**
   * SHA-256 hashes of erased players whose lake erasure has not published yet
   * (`ErasedPuuid.lakeErasedAt` null), read before the build. Every crawl
   * branch drops each match naming one of them at query time
   * (`crawl-union.ts`), so an erased player disappears from global reads the
   * moment the erasure is recorded, before any file is rewritten.
   */
  crawlTombstones: readonly string[];
};
