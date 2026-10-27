export type MediaOperation = {
  operationId: string;
  mediaId: string;
  generation: number;
};
export type MediaAttemptOperation = { operationId: string; attemptId: string };
export type MediaHandoffOperation = { operationId: string; planId: string };
export type LibraryPlexEditOperation = MediaHandoffOperation & {
  schemaVersion: 3;
  assetId: string;
};
export type HandoffObservationReference = { id: string; evidenceHash: string };
export type LibraryHandoffNetworkActivities = {
  plannedLibraryPlexEdits: (
    input: MediaHandoffOperation,
  ) => Promise<{ assetIds: string[] }>;
  editLibraryPlexEdition: (
    input: LibraryPlexEditOperation & {
      filesObservation: HandoffObservationReference;
    },
  ) => Promise<HandoffObservationReference>;
  protectLibraryHandoff: (input: MediaHandoffOperation) => Promise<void>;
};
export type LibraryHandoffFileActivities = {
  prepareLibraryPlexEditFile: (
    input: LibraryPlexEditOperation,
  ) => Promise<HandoffObservationReference>;
};
export type NativeRecoveryOperation = { operationId: string; planId: string };
export type NativeQuarantineRestoreOperation = MediaOperation & {
  continuationId: string;
};
export type NativeQuarantineNetworkActivities = {
  observeNativeQuarantine: (input: NativeRecoveryOperation) => Promise<void>;
};
export type NativeQuarantineFileActivities = {
  prepareNativeQuarantineFiles: (
    input: NativeRecoveryOperation,
  ) => Promise<void>;
  applyNativeQuarantineFiles: (input: NativeRecoveryOperation) => Promise<void>;
  restoreNativeQuarantineFiles: (
    input: NativeQuarantineRestoreOperation,
  ) => Promise<{ status: "restored" | "protected"; reason?: string }>;
};
export type NativeRecoveryNetworkActivities = {
  observeNativeRecovery: (input: NativeRecoveryOperation) => Promise<void>;
  nativeRecoveryState: (
    input: NativeRecoveryOperation,
  ) => Promise<{ state: string; applied: boolean }>;
};
export type NativeRecoveryFileActivities = {
  prepareNativeRecoveryFiles: (input: NativeRecoveryOperation) => Promise<void>;
  applyNativeRecoveryFiles: (input: NativeRecoveryOperation) => Promise<void>;
};
export type MediaHandoffNetworkActivities = {
  observeMediaHandoff: (input: MediaHandoffOperation) => Promise<void>;
  mediaHandoffState: (
    input: MediaHandoffOperation,
  ) => Promise<{ state: string; applied: boolean }>;
};
export type MediaHandoffFileActivities = {
  prepareMediaHandoffFiles: (input: MediaHandoffOperation) => Promise<void>;
  applyMediaHandoffFiles: (input: MediaHandoffOperation) => Promise<void>;
};
export type MediaDecisionOperation = {
  operationId: string;
  decisionId: string;
};
export type MediaWorkflowResult = {
  status: "completed" | "waiting" | "blocked" | "obsolete";
  reason?: string;
};

/** Workflow payloads contain identifiers only. Providers and paths stay in Activities. */
export type MediaNetworkActivities = PlexBindingActivities & {
  observeMediaUpgradeCleanup: (
    input: UpgradeCleanupPlexInput,
  ) => Promise<ObserveMediaUpgradeCleanupResult>;
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
  publishRolledBackMedia: (input: MediaAttemptOperation) => Promise<{
    status: "available" | "waiting" | "blocked" | "not_applicable";
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
    forced?: boolean;
    hearingImpaired?: "required" | "excluded" | "any";
    targetAuthority?: string;
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
  cleanupSupersededMediaFile: (input: {
    operationId: string;
    cleanupId: string;
  }) => Promise<{
    status: "purged" | "protected" | "obsolete";
    reason?: string;
  }>;
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
  }) => Promise<{
    status: "installed" | "obsolete" | "blocked";
    reason?: string;
  }>;
};
import type { PlexBindingActivities } from "./plex-binding/activities.ts";
import type {
  UpgradeCleanupPlexInput,
  ObserveMediaUpgradeCleanupResult,
} from "./plex-binding/cleanup.ts";
