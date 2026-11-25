import { z } from "zod";

export const DEFAULT_PUBLIC_INGEST_HOST = "https://logging.sjer.red";
export const DEFAULT_TAILNET_CONSOLE_URL = "https://errors.tailnet-1a49.ts.net";
export const DEFAULT_TRACKER_BASE_URL = "https://tracker.tailnet-1a49.ts.net";

export const ProjectSlugSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9][a-z0-9-_]*$/u);

export const IssueStateSchema = z.enum([
  "OPEN",
  "RESOLVED",
  "RESOLVED_NEXT_RELEASE",
  "MUTED",
]);
export type IssueState = z.infer<typeof IssueStateSchema>;

export const IssueFilterTabSchema = z.enum([
  "unresolved",
  "regressed",
  "muted",
  "resolved",
  "all",
]);
export type IssueFilterTab = z.infer<typeof IssueFilterTabSchema>;

export const ErrorLevelSchema = z.enum([
  "fatal",
  "error",
  "warning",
  "log",
  "info",
  "debug",
]);
export type ErrorLevel = z.infer<typeof ErrorLevelSchema>;

export const ViewerSchema = z.object({
  login: z.string().nullable(),
  displayName: z.string().nullable(),
});
export type Viewer = z.infer<typeof ViewerSchema>;

export const ProjectSummarySchema = z.object({
  id: z.number().int().positive(),
  slug: z.string(),
  name: z.string(),
  publicKey: z.string(),
  dsn: z.string(),
  legacyDsn: z.string(),
  digestedEventCount: z.number().int().nonnegative(),
  storedEventCount: z.number().int().nonnegative(),
  unresolvedCount: z.number().int().nonnegative(),
  regressedCount: z.number().int().nonnegative(),
  mutedCount: z.number().int().nonnegative(),
  activeIssues7d: z.number().int().nonnegative(),
  alertOnNewIssue: z.boolean(),
  alertOnRegression: z.boolean(),
  retentionMaxEvents: z.number().int().positive(),
  createdAt: z.string(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const CreateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: ProjectSlugSchema.optional(),
  alertOnNewIssue: z.boolean().default(true),
  alertOnRegression: z.boolean().default(true),
  retentionMaxEvents: z.number().int().min(1).max(1000).default(50),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  alertOnNewIssue: z.boolean().optional(),
  alertOnRegression: z.boolean().optional(),
  retentionMaxEvents: z.number().int().min(1).max(1000).optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

export const IssueListItemSchema = z.object({
  id: z.uuid(),
  projectId: z.number().int().positive(),
  projectSlug: z.string(),
  projectName: z.string(),
  primaryFingerprint: z.string(),
  type: z.string(),
  value: z.string(),
  transaction: z.string(),
  level: z.string(),
  state: IssueStateSchema,
  resolvedInRelease: z.string().nullable(),
  regressedCount: z.number().int().nonnegative(),
  digestedEventCount: z.number().int().nonnegative(),
  storedEventCount: z.number().int().nonnegative(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  lastRelease: z.string().nullable(),
  trackerIssueIdentifier: z.string().nullable(),
  revision: z.number().int().positive(),
});
export type IssueListItem = z.infer<typeof IssueListItemSchema>;

export const IssueSortSchema = z.enum(["last_seen", "events", "first_seen"]);
export type IssueSort = z.infer<typeof IssueSortSchema>;

export const SortOrderSchema = z.enum(["asc", "desc"]);
export type SortOrder = z.infer<typeof SortOrderSchema>;

export const IssueListQuerySchema = z.object({
  project: z.string().trim().min(1).optional(),
  tab: IssueFilterTabSchema.optional(),
  state: IssueStateSchema.optional(),
  q: z.string().trim().max(500).optional(),
  release: z.string().trim().max(250).optional(),
  hasTrackerIssue: z.enum(["true", "false"]).optional(),
  sort: IssueSortSchema.default("last_seen"),
  order: SortOrderSchema.default("desc"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type IssueListQuery = z.infer<typeof IssueListQuerySchema>;

export const IssueListResponseSchema = z.object({
  items: z.array(IssueListItemSchema),
  nextCursor: z.string().nullable(),
});
export type IssueListResponse = z.infer<typeof IssueListResponseSchema>;

export const UpdateIssueStateInputSchema = z.object({
  state: IssueStateSchema,
  resolvedInRelease: z.string().trim().min(1).max(250).nullable().optional(),
  expectedRevision: z.number().int().positive().optional(),
});
export type UpdateIssueStateInput = z.infer<typeof UpdateIssueStateInputSchema>;

export const BulkUpdateIssuesInputSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(200),
  state: IssueStateSchema,
  resolvedInRelease: z.string().trim().min(1).max(250).nullable().optional(),
});
export type BulkUpdateIssuesInput = z.infer<typeof BulkUpdateIssuesInputSchema>;

export const BulkUpdateIssuesResponseSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
  items: z.array(IssueListItemSchema),
});
export type BulkUpdateIssuesResponse = z.infer<
  typeof BulkUpdateIssuesResponseSchema
>;

export const TrackerTriageUrgencySchema = z.enum(["high", "medium", "low"]);
export const TrackerTriageImpactSchema = z.enum(["high", "medium", "low"]);
export const TrackerTriageEffortSchema = z.enum(["xs", "s", "m", "l", "xl"]);

export const CreateTrackerIssueInputSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  urgency: TrackerTriageUrgencySchema.default("medium"),
  impact: TrackerTriageImpactSchema.default("medium"),
  effort: TrackerTriageEffortSchema.default("s"),
});
export type CreateTrackerIssueInput = z.infer<
  typeof CreateTrackerIssueInputSchema
>;

export const CreateTrackerIssueResponseSchema = z.object({
  trackerIssueIdentifier: z.string(),
  trackerUrl: z.string(),
  created: z.boolean(),
  issue: IssueListItemSchema,
});
export type CreateTrackerIssueResponse = z.infer<
  typeof CreateTrackerIssueResponseSchema
>;

export const EventListItemSchema = z.object({
  id: z.uuid(),
  eventId: z.string(),
  issueId: z.uuid(),
  projectId: z.number().int().positive(),
  timestamp: z.string(),
  ingestedAt: z.string(),
  release: z.string().nullable(),
  environment: z.string().nullable(),
  platform: z.string().nullable(),
  level: z.string(),
  transaction: z.string(),
});
export type EventListItem = z.infer<typeof EventListItemSchema>;

export const EventListResponseSchema = z.object({
  items: z.array(EventListItemSchema),
  nextCursor: z.string().nullable(),
});
export type EventListResponse = z.infer<typeof EventListResponseSchema>;

export const StackFrameViewSchema = z.object({
  filename: z.string().nullable(),
  module: z.string().nullable(),
  function: z.string().nullable(),
  lineno: z.number().int().nullable(),
  colno: z.number().int().nullable(),
  inApp: z.boolean(),
  preContext: z.array(z.string()),
  contextLine: z.string().nullable(),
  postContext: z.array(z.string()),
  vars: z.record(z.string(), z.unknown()).nullable(),
});
export type StackFrameView = z.infer<typeof StackFrameViewSchema>;

export const ExceptionViewSchema = z.object({
  type: z.string(),
  value: z.string(),
  mechanismType: z.string().nullable(),
  handled: z.boolean().nullable(),
  frames: z.array(StackFrameViewSchema),
});
export type ExceptionView = z.infer<typeof ExceptionViewSchema>;

export const BreadcrumbViewSchema = z.object({
  timestamp: z.string().nullable(),
  type: z.string().nullable(),
  category: z.string().nullable(),
  level: z.string().nullable(),
  message: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
});
export type BreadcrumbView = z.infer<typeof BreadcrumbViewSchema>;

export const EventDetailSchema = EventListItemSchema.extend({
  stacktraceMd: z.string(),
  exceptions: z.array(ExceptionViewSchema),
  breadcrumbs: z.array(BreadcrumbViewSchema),
  tags: z.record(z.string(), z.string()),
  contexts: z.record(z.string(), z.unknown()),
  request: z.record(z.string(), z.unknown()).nullable(),
  sdk: z
    .object({
      name: z.string().nullable(),
      version: z.string().nullable(),
    })
    .nullable(),
  rawData: z.record(z.string(), z.unknown()),
});
export type EventDetail = z.infer<typeof EventDetailSchema>;

export const IssueDetailSchema = IssueListItemSchema.extend({
  fingerprints: z.array(z.string()),
  latestEvent: EventDetailSchema.nullable(),
});
export type IssueDetail = z.infer<typeof IssueDetailSchema>;

export const ReleaseItemSchema = z.object({
  id: z.uuid(),
  projectId: z.number().int().positive(),
  projectSlug: z.string(),
  version: z.string(),
  releasedAt: z.string(),
});
export type ReleaseItem = z.infer<typeof ReleaseItemSchema>;

export const CreateReleaseInputSchema = z.object({
  project: z.union([z.number().int().positive(), z.string().min(1)]),
  version: z.string().trim().min(1).max(250),
  releasedAt: z.iso.datetime().optional(),
});
export type CreateReleaseInput = z.infer<typeof CreateReleaseInputSchema>;

export const ReleaseListResponseSchema = z.object({
  items: z.array(ReleaseItemSchema),
});
export type ReleaseListResponse = z.infer<typeof ReleaseListResponseSchema>;

export const OverviewResponseSchema = z.object({
  viewer: ViewerSchema,
  totalUnresolved: z.number().int().nonnegative(),
  totalRegressed: z.number().int().nonnegative(),
  activeIssues7d: z.number().int().nonnegative(),
  events24h: z.number().int().nonnegative(),
  totalDigestedEvents: z.number().int().nonnegative(),
  totalStoredEvents: z.number().int().nonnegative(),
  projects: z.array(ProjectSummarySchema),
  attentionIssues: z.array(IssueListItemSchema),
});
export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;

export const OpsProjectSummarySchema = z.object({
  id: z.number().int().positive(),
  slug: z.string(),
  name: z.string(),
  url: z.string(),
  activeIssues7d: z.number().int().nonnegative(),
  staleIssues: z.number().int().nonnegative(),
  mutedIssues: z.number().int().nonnegative(),
  digestedEventsTotal: z.number().int().nonnegative(),
  topIssueTitle: z.string().optional(),
});
export type OpsProjectSummary = z.infer<typeof OpsProjectSummarySchema>;

export const OpsTopIssueSchema = z.object({
  id: z.uuid(),
  projectSlug: z.string(),
  type: z.string(),
  value: z.string(),
  transaction: z.string(),
  events: z.number().int().nonnegative(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  muted: z.boolean(),
  trackerIssueIdentifier: z.string().nullable(),
  url: z.string(),
});
export type OpsTopIssue = z.infer<typeof OpsTopIssueSchema>;

export const OpsSummaryResponseSchema = z.object({
  totalUnresolved: z.number().int().nonnegative(),
  totalDigestedEvents: z.number().int().nonnegative(),
  projects: z.array(OpsProjectSummarySchema),
  topIssues: z.array(OpsTopIssueSchema),
});
export type OpsSummaryResponse = z.infer<typeof OpsSummaryResponseSchema>;

export const BugsinkImportRequestSchema = z.object({
  baseUrl: z.url().optional(),
  dryRun: z.boolean().default(false),
  concurrency: z.number().int().min(1).max(32).default(8),
  projectId: z.number().int().positive().optional(),
});
export type BugsinkImportRequest = z.infer<typeof BugsinkImportRequestSchema>;

export const BugsinkImportResultSchema = z.object({
  dryRun: z.boolean(),
  projectsImported: z.number().int().nonnegative(),
  releasesImported: z.number().int().nonnegative(),
  issuesImported: z.number().int().nonnegative(),
  eventsImported: z.number().int().nonnegative(),
  eventsSkippedExisting: z.number().int().nonnegative(),
  fingerprintsRegistered: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type BugsinkImportResult = z.infer<typeof BugsinkImportResultSchema>;

export function buildProjectDsn(
  publicKey: string,
  projectId: number,
  ingestOrigin = DEFAULT_PUBLIC_INGEST_HOST,
): string {
  const parsed = new URL(ingestOrigin);
  parsed.username = publicKey;
  parsed.pathname = `/${String(projectId)}`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}
