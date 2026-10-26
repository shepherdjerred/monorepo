import type { ScoutPipelineActivities } from "@scout-for-lol/temporal/activities";

export type ScoutNotificationActivities = Pick<
  ScoutPipelineActivities,
  | "readNotificationIntent"
  | "markNotificationReady"
  | "beginNotificationSend"
  | "deliverNotification"
  | "recordNotificationOutcome"
  | "afterNotificationDelivered"
>;

export type ScoutBackgroundActivities = Pick<
  ScoutPipelineActivities,
  | "renderNotificationArtifact"
  | "readRecoveryBatch"
  | "scanRecoveryPage"
  | "processRecoveryPage"
  | "digestRecoveryBatch"
  | "closeRecoveryBatch"
  | "scanPipelineReconciliationPage"
  | "backfillSilentPostmatchArtifact"
>;

export type ScoutLakeActivities = Pick<
  ScoutPipelineActivities,
  "stageLakeProjection"
>;
