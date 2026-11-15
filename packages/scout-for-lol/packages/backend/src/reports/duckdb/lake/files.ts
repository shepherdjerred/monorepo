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
};
