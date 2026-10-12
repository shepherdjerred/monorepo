/** Paths captured together for one report-lake query attempt. */
export type LakeFiles = {
  matchesParquet: string[];
  matchesStaging: string[];
  /** False only for the exact published Prod layout predating data_source. */
  matchesHasDataSource?: boolean;
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
};
