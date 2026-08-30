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
  ) => Promise<readonly PendingEmail[]>;
  markEmailSent: (id: string, sentAtNs: bigint) => Promise<void>;
  markEmailFailed: (
    id: string,
    failedAtNs: bigint,
    nextAttemptAtNs: bigint,
    error: string,
  ) => Promise<void>;
  purgeExpiredRawPayloads: (nowNs: bigint) => Promise<number>;
  disconnect: () => Promise<void>;
};

export type AlertmanagerPort = {
  activeAlerts: () => Promise<readonly AlertmanagerSnapshotAlert[]>;
};

export type PostalPort = {
  send: (input: {
    messageId: string;
    subject: string;
    htmlBody: string;
  }) => Promise<void>;
};

export type PreviewPort = {
  previews: (input: PreviewInput, alert: AlertDetail) => Promise<Previews>;
  health: () => Promise<boolean>;
};
