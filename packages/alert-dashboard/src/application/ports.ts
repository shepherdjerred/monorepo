import type {
  ChangeEvent,
  Snapshot,
} from "@shepherdjerred/ops-model/snapshot.ts";

import type { AlertLedgerChange } from "#domain/ops-changes";
import type {
  ChangeView,
  CursorConsumer,
  DigestKind,
} from "#shared/ops-schema";
import type {
  AlertDetail,
  AlertDetailInput,
  AlertListInput,
  AlertListResponse,
  AlertmanagerSnapshotAlert,
  AlertmanagerWebhook,
  EventListInput,
  EventListResponse,
  PreviewInput,
  Previews,
  Summary,
  SystemStatus,
  JsonObject,
} from "#shared/schema";

export type IngestWebhookInput = {
  payload: AlertmanagerWebhook;
  rawPayload: JsonObject;
  payloadHash: string;
  receivedAtNs: bigint;
  rawExpiresAtNs: bigint;
  emailEnabled: boolean;
};

export type IngestWebhookResult = {
  deliveryId: string;
  opened: number;
  resolved: number;
  emailQueued: boolean;
};

export type ReconcileSnapshotInput = {
  alerts: readonly AlertmanagerSnapshotAlert[];
  startedAtNs: bigint;
  completedAtNs: bigint;
  missingGraceNs: bigint;
};

export type ReconcileSnapshotResult = {
  active: number;
  opened: number;
  resolved: number;
};

export type PendingEmail = {
  id: string;
  messageId: string;
  subject: string;
  htmlBody: string;
  attemptCount: number;
};

export type ClaimedPendingEmail = PendingEmail & {
  sendClaimId: string;
};

export type EmailSendSuccessInput = {
  id: string;
  sendClaimId: string;
  sentAtNs: bigint;
};

export type EmailSendFailureInput = {
  id: string;
  sendClaimId: string;
  failedAtNs: bigint;
  nextAttemptAtNs: bigint;
  error: string;
};

export type AlertLedgerRepository = {
  ingestWebhook: (input: IngestWebhookInput) => Promise<IngestWebhookResult>;
  reconcileSnapshot: (
    input: ReconcileSnapshotInput,
  ) => Promise<ReconcileSnapshotResult>;
  recordSnapshotFailure: (
    startedAtNs: bigint,
    completedAtNs: bigint,
    error: string,
  ) => Promise<void>;
  listAlerts: (input: AlertListInput) => Promise<AlertListResponse>;
  getAlert: (input: AlertDetailInput) => Promise<AlertDetail | null>;
  listEvents: (input: EventListInput) => Promise<EventListResponse>;
  summary: () => Promise<Summary>;
  checkDatabase: () => Promise<void>;
  systemStatus: (emailEnabled: boolean, nowNs: bigint) => Promise<SystemStatus>;
  pendingEmails: (
    nowNs: bigint,
    limit: number,
  ) => Promise<readonly PendingEmail[]>;
  claimPendingEmails: (
    nowNs: bigint,
    limit: number,
    sendingAtNs: bigint,
  ) => Promise<readonly ClaimedPendingEmail[]>;
  markEmailSent: (input: EmailSendSuccessInput) => Promise<void>;
  markEmailFailed: (input: EmailSendFailureInput) => Promise<void>;
  purgeExpiredRawPayloads: (nowNs: bigint) => Promise<number>;
  disconnect: () => Promise<void>;
};

export type AlertmanagerPort = {
  activeAlerts: () => Promise<readonly AlertmanagerSnapshotAlert[]>;
};

export type PostalMessage = {
  messageId: string;
  subject: string;
  htmlBody: string;
  /** Plain-text alternative; digests send one, alert openings do not. */
  plainBody?: string;
  /** Postal tag; defaults to the alert-opening tag. */
  tag?: string;
};

export type PostalPort = {
  send: (input: PostalMessage) => Promise<void>;
};

export type PreviewPort = {
  previews: (input: PreviewInput, alert: AlertDetail) => Promise<Previews>;
  health: () => Promise<boolean>;
};

export type StoredOpsSnapshot = {
  id: string;
  generatedAtNs: bigint;
  receivedAtNs: bigint;
  snapshot: Snapshot;
};

export type StoreOpsSnapshotInput = {
  snapshot: Snapshot;
  generatedAtNs: bigint;
  receivedAtNs: bigint;
  changes: readonly (ChangeEvent & { occurredAtNs: bigint })[];
  retentionDays: number;
};

export type StoreOpsSnapshotResult = {
  snapshotId: string;
  changesUpserted: number;
  pruned: number;
};

export type ChangeQuery = {
  service?: string;
  sinceNs?: bigint;
  untilNs?: bigint;
  limit: number;
};

export type AlertChangeQuery = {
  /** Restrict to these alert namespaces; `undefined` means every alert. */
  namespaces?: readonly string[];
  sinceNs?: bigint;
  untilNs?: bigint;
  limit: number;
};

export type ViewerCursorRecord = {
  consumer: CursorConsumer;
  lastSeenAtNs: bigint;
  seenSignalIds: readonly string[];
};

export type IncidentWindowStats = {
  opened: number;
  /** Open-to-resolve durations of occurrences resolved inside the window. */
  resolveDurationsNs: readonly bigint[];
};

export type DigestRunKey = {
  kind: DigestKind;
  periodKey: string;
  messageId: string;
};

export type DigestClaim =
  | { outcome: "claimed" }
  | { outcome: "done"; status: "sent" | "skipped" }
  | { outcome: "busy" };

export type OpsRepository = {
  storeSnapshot: (
    input: StoreOpsSnapshotInput,
  ) => Promise<StoreOpsSnapshotResult>;
  latestSnapshot: () => Promise<StoredOpsSnapshot | null>;
  /** The newest stored snapshot generated at or before `targetNs`. */
  snapshotAtOrBefore: (targetNs: bigint) => Promise<StoredOpsSnapshot | null>;
  listChanges: (query: ChangeQuery) => Promise<ChangeView[]>;
  countChanges: (input: {
    kind: ChangeEvent["kind"];
    sinceNs: bigint;
    untilNs: bigint;
  }) => Promise<number>;
  alertChanges: (query: AlertChangeQuery) => Promise<AlertLedgerChange[]>;
  incidentStats: (input: {
    sinceNs: bigint;
    untilNs: bigint;
  }) => Promise<IncidentWindowStats>;
  getCursor: (consumer: CursorConsumer) => Promise<ViewerCursorRecord | null>;
  putCursor: (record: ViewerCursorRecord) => Promise<void>;
  /** Record a skipped run unless the period already has one. */
  recordDigestSkip: (
    key: DigestRunKey,
    nowNs: bigint,
  ) => Promise<{ created: boolean; status: "sent" | "skipped" | "pending" }>;
  claimDigestRun: (
    key: DigestRunKey,
    nowNs: bigint,
    staleBeforeNs: bigint,
  ) => Promise<DigestClaim>;
  markDigestSent: (
    key: DigestRunKey,
    input: { sentAtNs: bigint; subject: string },
  ) => Promise<void>;
  markDigestFailed: (key: DigestRunKey, error: string) => Promise<void>;
};

export type SeriesRangeRequest = {
  promql: string;
  startSeconds: number;
  endSeconds: number;
  stepSeconds: number;
};

export type SeriesPort = {
  range: (request: SeriesRangeRequest) => Promise<
    readonly {
      metric: Readonly<Record<string, string>>;
      points: readonly [number, number][];
    }[]
  >;
  scalar: (promql: string) => Promise<number | null>;
};

export type DigestGatePort = {
  digestEmailEnabled: () => Promise<boolean>;
};
