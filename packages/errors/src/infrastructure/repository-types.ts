import type { NormalizedSentryEvent } from "#domain/envelope-normalize.ts";
import type { OutboxAlertKind } from "#domain/lifecycle.ts";
import type { CanonicalProjectSeed } from "#infrastructure/seed-projects.ts";
import type {
  BulkUpdateIssuesInput,
  BulkUpdateIssuesResponse,
  CreateProjectInput,
  CreateReleaseInput,
  EventDetail,
  EventListResponse,
  IssueDetail,
  IssueListItem,
  IssueListQuery,
  IssueListResponse,
  IssueState,
  OpsSummaryResponse,
  OverviewResponse,
  ProjectSummary,
  ReleaseItem,
  ReleaseListResponse,
  UpdateIssueStateInput,
  UpdateProjectInput,
  Viewer,
} from "#shared/contract.ts";

export type RepositoryUrlOptions = {
  readonly publicIngestOrigin?: string | undefined;
  readonly legacyIngestOrigin?: string | undefined;
  readonly consolePublicOrigin?: string | undefined;
  readonly now?: (() => Date) | undefined;
};

export type IngestEventInput = {
  readonly projectId: number;
  readonly publicKey: string;
  readonly normalizedEvent: NormalizedSentryEvent;
};

export type IngestEventResult =
  | { readonly status: "unauthorized" }
  | {
      readonly status: "duplicate";
      readonly eventId: string;
      readonly issueId: string;
    }
  | {
      readonly status: "accepted";
      readonly eventId: string;
      readonly issueId: string;
      readonly outboxId: string | null;
      readonly isNewIssue: boolean;
      readonly regressed: boolean;
    };

export type UpdateIssueStateResult =
  | { readonly status: "ok"; readonly issue: IssueListItem }
  | { readonly status: "not_found" }
  | { readonly status: "conflict"; readonly current: IssueListItem };

export type ImportedProjectInput = {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly publicKey: string;
  readonly digestedEventCount: number;
  readonly storedEventCount: number;
  readonly alertOnNewIssue: boolean;
  readonly alertOnRegression: boolean;
};

export type ImportedReleaseInput = {
  readonly id: string;
  readonly projectId: number;
  readonly version: string;
  readonly releasedAt: Date;
};

export type ImportedIssueInput = {
  readonly id: string;
  readonly projectId: number;
  readonly type: string;
  readonly value: string;
  readonly transaction: string;
  readonly level: string;
  readonly state: IssueState;
  readonly digestedEventCount: number;
  readonly storedEventCount: number;
  readonly firstSeen: Date;
  readonly lastSeen: Date;
};

export type ImportedEventInput = {
  readonly id: string;
  readonly eventId: string;
  readonly issueId: string;
  readonly projectId: number;
  readonly timestamp: Date;
  readonly ingestedAt: Date;
  readonly release: string | null;
  readonly environment: string | null;
  readonly platform: string | null;
  readonly level: string;
  readonly transaction: string;
  readonly data: Record<string, unknown>;
  readonly stacktraceMd: string;
  readonly computedFingerprint: string;
};

export type ClaimedOutboxNotification = {
  readonly id: string;
  readonly issueId: string;
  readonly eventId: string;
  readonly kind: OutboxAlertKind;
  readonly messageId: string;
  readonly attempts: number;
  readonly projectSlug: string;
  readonly projectName: string;
  readonly issueType: string;
  readonly issueValue: string;
  readonly transaction: string;
  readonly release: string | null;
  readonly environment: string | null;
  readonly stacktraceMd: string;
};

export type ProjectMetricsSnapshot = {
  readonly slug: string;
  readonly unresolvedCount: number;
  readonly digestedEventCount: number;
};

export type MetricsSnapshot = {
  readonly projects: readonly ProjectMetricsSnapshot[];
  readonly pendingOutboxCount: number;
};

export type ErrorsRepository = {
  readonly ping: () => Promise<boolean>;
  readonly close: () => Promise<void>;
  readonly seedCanonicalProjects: (
    seeds?: readonly CanonicalProjectSeed[],
  ) => Promise<number>;
  readonly ingestEvent: (input: IngestEventInput) => Promise<IngestEventResult>;
  readonly getOverview: (viewer: Viewer) => Promise<OverviewResponse>;
  readonly getOpsSummary: () => Promise<OpsSummaryResponse>;
  readonly getMetricsSnapshot: () => Promise<MetricsSnapshot>;
  readonly listProjects: () => Promise<ProjectSummary[]>;
  readonly getProject: (
    idOrSlug: string | number,
  ) => Promise<ProjectSummary | null>;
  readonly createProject: (
    input: CreateProjectInput,
  ) => Promise<ProjectSummary>;
  readonly updateProject: (
    idOrSlug: string | number,
    input: UpdateProjectInput,
  ) => Promise<ProjectSummary | null>;
  readonly listIssues: (query: IssueListQuery) => Promise<IssueListResponse>;
  readonly getIssue: (id: string) => Promise<IssueDetail | null>;
  readonly updateIssueState: (
    id: string,
    input: UpdateIssueStateInput,
  ) => Promise<UpdateIssueStateResult>;
  readonly bulkUpdateIssues: (
    input: BulkUpdateIssuesInput,
  ) => Promise<BulkUpdateIssuesResponse>;
  readonly setTrackerIssue: (
    issueId: string,
    trackerIssueIdentifier: string,
  ) => Promise<IssueListItem | null>;
  readonly listEvents: (
    issueId: string,
    options?: {
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    },
  ) => Promise<EventListResponse | null>;
  readonly getEvent: (idOrEventId: string) => Promise<EventDetail | null>;
  readonly listReleases: (
    projectFilter?: string | number,
  ) => Promise<ReleaseListResponse>;
  readonly createRelease: (
    input: CreateReleaseInput,
  ) => Promise<ReleaseItem | null>;
  readonly upsertImportedProject: (
    input: ImportedProjectInput,
  ) => Promise<void>;
  readonly upsertImportedRelease: (
    input: ImportedReleaseInput,
  ) => Promise<void>;
  readonly upsertImportedIssue: (input: ImportedIssueInput) => Promise<void>;
  readonly listExistingEventIdsForIssue: (
    issueId: string,
  ) => Promise<Set<string>>;
  readonly insertImportedEvent: (input: ImportedEventInput) => Promise<{
    readonly inserted: boolean;
    readonly fingerprintRegistered: boolean;
  }>;
  readonly reconcileImportedCounts: (
    projectIds?: readonly number[],
  ) => Promise<void>;
  readonly claimPendingOutbox: (
    limit: number,
    now?: Date,
  ) => Promise<ClaimedOutboxNotification[]>;
  readonly completeOutbox: (id: string, sentAt?: Date) => Promise<void>;
  readonly failOutbox: (
    id: string,
    errorMessage: string,
    nextAttemptAt: Date,
  ) => Promise<void>;
};
