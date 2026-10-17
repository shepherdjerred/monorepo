export type MediaOperation = {
  operationId: string;
  mediaId: string;
  generation: number;
};
export type MediaAttemptOperation = { operationId: string; attemptId: string };
export type MediaDecisionOperation = {
  operationId: string;
  decisionId: string;
};
export type MediaWorkflowResult = {
  status: "completed" | "waiting" | "blocked" | "obsolete";
  reason?: string;
};

/** Workflow payloads contain identifiers only. Providers and paths stay in Activities. */
export type MediaNetworkActivities = {
  refreshMediaCatalog: (input: {
    operationId: string;
    mediaId: string;
    cursor: string | null;
  }) => Promise<{ processed: number; nextCursor: string | null }>;
  expandCatalogRequests: (input: {
    operationId: string;
    mediaId: string;
    cursor: string | null;
  }) => Promise<{ processed: number; nextCursor: string | null }>;
  expandMediaRequest: (input: {
    operationId: string;
    requestId: string;
    requestVersion: number;
    cursor: string | null;
  }) => Promise<{ processed: number; nextCursor: string | null }>;
  dispatchMediaOutbox: () => Promise<{ dispatched: number; deferred: number }>;
  sweepMediaWork: (input: {
    sweepId: string;
    kind: "downloads" | "watch" | "feeds" | "due" | "inventory";
    cursor: string | null;
  }) => Promise<{ processed: number; nextCursor: string | null }>;
  reconcileMediaIntent: (input: MediaOperation) => Promise<{
    status: "available" | "waiting" | "blocked" | "obsolete" | "acquire";
    attemptId: string | null;
    reason: string | null;
  }>;
  submitMediaTorrent: (input: MediaAttemptOperation) => Promise<{
    status: "submitted" | "waiting" | "blocked" | "obsolete";
    reason: string | null;
  }>;
  observeMediaAcquisition: (input: MediaAttemptOperation) => Promise<{
    status: "downloading" | "ready" | "blocked" | "obsolete";
    reason: string | null;
  }>;
  publishMediaToPlex: (input: MediaAttemptOperation) => Promise<{
    status: "available" | "waiting" | "blocked";
    reason: string | null;
  }>;
  publishRestoredMedia: (input: MediaOperation) => Promise<{
    status: "available" | "waiting" | "blocked";
    reason: string | null;
  }>;
  finalizeMediaAcquisition: (input: MediaAttemptOperation) => Promise<void>;
  findMediaSubtitles: (input: {
    operationId: string;
    assetId: string;
    language: string;
  }) => Promise<{
    status: "found" | "waiting" | "obsolete" | "blocked";
    subtitleId: string | null;
    reason: string | null;
  }>;
  evaluateMediaSeeding: (input: {
    operationId: string;
    torrentId: string;
  }) => Promise<{
    status: "seeding" | "removable" | "protected" | "removed";
    reason: string | null;
  }>;
  removeMediaTorrent: (input: {
    operationId: string;
    torrentId: string;
  }) => Promise<{ status: "removed" | "protected"; reason: string | null }>;
  evaluateMediaRetention: (input: MediaOperation) => Promise<{
    status:
      | "protected"
      | "warning"
      | "grace"
      | "quarantine"
      | "purge"
      | "complete"
      | "obsolete";
    decisionId: string | null;
    wakeAt: string | null;
    reason: string | null;
  }>;
  deliverMediaNotification: (input: {
    operationId: string;
    notificationId: string;
  }) => Promise<{
    status: "accepted" | "failed" | "unknown";
    reason: string | null;
  }>;
  finishMediaOperation: (input: {
    operationId: string;
    status: "completed" | "failed" | "reconciling";
    reason: string | null;
  }) => Promise<void>;
};

export type MediaFileActivities = {
  inspectAndStageMedia: (
    input: MediaAttemptOperation,
  ) => Promise<{ status: "staged" | "blocked"; reason?: string }>;
  promoteMediaFiles: (input: MediaAttemptOperation) => Promise<{
    status: "published" | "blocked" | "obsolete";
    reason?: string;
  }>;
  rollbackMediaPromotion: (
    input: MediaAttemptOperation,
  ) => Promise<{ status: "rolled_back" | "protected"; reason?: string }>;
  quarantineMediaFiles: (
    input: MediaDecisionOperation,
  ) => Promise<{ status: "quarantined" | "protected"; reason?: string }>;
  restoreMediaFiles: (input: {
    mediaId: string;
    operationId: string;
  }) => Promise<{
    status: "restored" | "missing" | "protected";
    reason?: string;
  }>;
  purgeMediaFiles: (
    input: MediaDecisionOperation,
  ) => Promise<{ status: "purged" | "protected"; reason?: string }>;
  installMediaSubtitles: (input: {
    subtitleId: string;
    operationId: string;
  }) => Promise<{ status: "installed" | "obsolete" }>;
};
