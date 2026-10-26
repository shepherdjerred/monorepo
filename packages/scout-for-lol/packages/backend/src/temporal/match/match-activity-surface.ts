import type { ScoutPipelineActivities } from "@scout-for-lol/temporal/activities";

export type ScoutMatchActivities = Pick<
  ScoutPipelineActivities,
  | "discoverPostMatchIds"
  | "readMatchPipelineState"
  | "readLegacyMatchCompletionV2"
  | "archiveMatchArtifacts"
  | "prepareMatchEvidence"
  | "queueHistoryMatch"
  | "commitMatchObservation"
  | "settleMatchMarkets"
  | "applyMatchProgression"
  | "finalizeTournamentResult"
  | "recordMatchReceipts"
  | "recordClientMatchTerminal"
  | "advanceMatchCursor"
  | "mintPostmatchNotificationIntents"
  | "planMatchFanOut"
>;
