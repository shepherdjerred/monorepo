import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { extractEventDetailViews } from "#domain/stacktrace-markdown.ts";
import type { RepositoryUrlOptions } from "#infrastructure/repository-types.ts";
import {
  buildProjectDsn,
  DEFAULT_PUBLIC_INGEST_HOST,
  DEFAULT_TAILNET_CONSOLE_URL,
  type EventDetail,
  type EventListItem,
  type IssueListItem,
  type IssueState,
  type ProjectSummary,
} from "#shared/contract.ts";

export const DEFAULT_LEGACY_INGEST_HOST = "https://bugsink.sjer.red";
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const JsonValueSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const JsonRecordSchema = z.record(z.string(), JsonValueSchema);

export type ResolvedUrlConfig = {
  readonly publicIngestOrigin: string;
  readonly legacyIngestOrigin: string;
  readonly consolePublicOrigin: string;
  readonly now: () => Date;
};

export type StoredProjectRow = {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly publicKey: string;
  readonly digestedEventCount: bigint;
  readonly storedEventCount: number;
  readonly alertOnNewIssue: boolean;
  readonly alertOnRegression: boolean;
  readonly retentionMaxEvents: number;
  readonly createdAt: Date;
};

export type StoredIssueRow = {
  readonly id: string;
  readonly projectId: number;
  readonly primaryFingerprint: string;
  readonly type: string;
  readonly value: string;
  readonly transaction: string;
  readonly level: string;
  readonly state: IssueState;
  readonly resolvedInRelease: string | null;
  readonly regressedCount: number;
  readonly digestedEventCount: bigint;
  readonly storedEventCount: number;
  readonly firstSeen: Date;
  readonly lastSeen: Date;
  readonly lastRelease: string | null;
  readonly lastAlertedAt: Date | null;
  readonly trackerIssueIdentifier: string | null;
  readonly revision: number;
};

export type StoredEventRow = {
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
  readonly data: unknown;
  readonly stacktraceMd: string;
};

export type ProjectIssueAggregates = {
  readonly unresolvedCount: number;
  readonly regressedCount: number;
  readonly mutedCount: number;
  readonly activeIssues7d: number;
  readonly staleIssues: number;
  readonly topIssueTitle?: string | undefined;
};

export const EMPTY_PROJECT_AGGREGATES: ProjectIssueAggregates = {
  unresolvedCount: 0,
  regressedCount: 0,
  mutedCount: 0,
  activeIssues7d: 0,
  staleIssues: 0,
};

export function resolveUrlConfig(
  options?: RepositoryUrlOptions,
): ResolvedUrlConfig {
  return {
    publicIngestOrigin:
      options?.publicIngestOrigin ?? DEFAULT_PUBLIC_INGEST_HOST,
    legacyIngestOrigin:
      options?.legacyIngestOrigin ?? DEFAULT_LEGACY_INGEST_HOST,
    consolePublicOrigin: (
      options?.consolePublicOrigin ?? DEFAULT_TAILNET_CONSOLE_URL
    ).replace(/\/$/u, ""),
    now: options?.now ?? (() => new Date()),
  };
}

export function constantTimeStringEquals(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, "utf8");
  const rightBuf = Buffer.from(right, "utf8");
  return (
    leftBuf.byteLength === rightBuf.byteLength &&
    timingSafeEqual(leftBuf, rightBuf)
  );
}

export function generatePublicKey(): string {
  return randomBytes(16).toString("hex");
}

export function slugifyProjectName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z\d]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 50);
  return base.length > 0 ? base : "project";
}

export function parsePositiveIntId(idOrSlug: string | number): number | null {
  if (typeof idOrSlug === "number") {
    return Number.isInteger(idOrSlug) && idOrSlug > 0 ? idOrSlug : null;
  }
  if (/^\d+$/u.test(idOrSlug.trim())) {
    const parsed = Number.parseInt(idOrSlug.trim(), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export function isUuidString(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

export function shouldPreferCandidateIssueForFingerprint(
  candidate: { readonly state: IssueState; readonly lastSeen: Date },
  existing: { readonly state: IssueState; readonly lastSeen: Date },
): boolean {
  const candidateOpen = candidate.state === "OPEN";
  const existingOpen = existing.state === "OPEN";
  return candidateOpen === existingOpen
    ? candidate.lastSeen.getTime() > existing.lastSeen.getTime()
    : candidateOpen;
}

export function resolveNextReleaseValue(
  state: IssueState,
  explicitRelease: string | null | undefined,
  lastRelease: string | null,
): string | null {
  if (state === "RESOLVED_NEXT_RELEASE") {
    return explicitRelease === undefined ? lastRelease : explicitRelease;
  }
  return explicitRelease ?? null;
}

export function coerceRawDataRecord(raw: unknown): Record<string, unknown> {
  const parsed = JsonRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export function toProjectSummary(
  project: StoredProjectRow,
  aggregates: ProjectIssueAggregates,
  urls: ResolvedUrlConfig,
): ProjectSummary {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    publicKey: project.publicKey,
    dsn: buildProjectDsn(
      project.publicKey,
      project.id,
      urls.publicIngestOrigin,
    ),
    legacyDsn: buildProjectDsn(
      project.publicKey,
      project.id,
      urls.legacyIngestOrigin,
    ),
    digestedEventCount: Number(project.digestedEventCount),
    storedEventCount: project.storedEventCount,
    unresolvedCount: aggregates.unresolvedCount,
    regressedCount: aggregates.regressedCount,
    mutedCount: aggregates.mutedCount,
    activeIssues7d: aggregates.activeIssues7d,
    alertOnNewIssue: project.alertOnNewIssue,
    alertOnRegression: project.alertOnRegression,
    retentionMaxEvents: project.retentionMaxEvents,
    createdAt: project.createdAt.toISOString(),
  };
}

export function toIssueListItem(
  issue: StoredIssueRow,
  project: { readonly slug: string; readonly name: string },
): IssueListItem {
  return {
    id: issue.id,
    projectId: issue.projectId,
    projectSlug: project.slug,
    projectName: project.name,
    primaryFingerprint: issue.primaryFingerprint,
    type: issue.type,
    value: issue.value,
    transaction: issue.transaction,
    level: issue.level,
    state: issue.state,
    resolvedInRelease: issue.resolvedInRelease,
    regressedCount: issue.regressedCount,
    digestedEventCount: Number(issue.digestedEventCount),
    storedEventCount: issue.storedEventCount,
    firstSeen: issue.firstSeen.toISOString(),
    lastSeen: issue.lastSeen.toISOString(),
    lastRelease: issue.lastRelease,
    trackerIssueIdentifier: issue.trackerIssueIdentifier,
    revision: issue.revision,
  };
}

export function toEventListItem(event: StoredEventRow): EventListItem {
  return {
    id: event.id,
    eventId: event.eventId,
    issueId: event.issueId,
    projectId: event.projectId,
    timestamp: event.timestamp.toISOString(),
    ingestedAt: event.ingestedAt.toISOString(),
    release: event.release,
    environment: event.environment,
    platform: event.platform,
    level: event.level,
    transaction: event.transaction,
  };
}

export function toEventDetail(event: StoredEventRow): EventDetail {
  const rawData = coerceRawDataRecord(event.data);
  const views = extractEventDetailViews(rawData);
  return {
    ...toEventListItem(event),
    stacktraceMd: event.stacktraceMd,
    exceptions: views.exceptions,
    breadcrumbs: views.breadcrumbs,
    tags: views.tags,
    contexts: views.contexts,
    request: views.request,
    sdk: views.sdk,
    rawData,
  };
}
