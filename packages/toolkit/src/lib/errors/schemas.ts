import { z } from "zod";

export const DEFAULT_ERRORS_URL = "https://errors.tailnet-1a49.ts.net";

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

export const ProjectListResponseSchema = z.union([
  z.array(ProjectSummarySchema),
  z.object({ items: z.array(ProjectSummarySchema) }).transform((v) => v.items),
  z
    .object({ projects: z.array(ProjectSummarySchema) })
    .transform((v) => v.projects),
]);

export const ProjectResponseSchema = z.union([
  ProjectSummarySchema,
  z.object({ project: ProjectSummarySchema }).transform((v) => v.project),
]);

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

export const IssueListResponseSchema = z.object({
  items: z.array(IssueListItemSchema),
  nextCursor: z.string().nullable(),
});
export type IssueListResponse = z.infer<typeof IssueListResponseSchema>;

export const BulkUpdateIssuesResponseSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
  items: z.array(IssueListItemSchema),
});
export type BulkUpdateIssuesResponse = z.infer<
  typeof BulkUpdateIssuesResponseSchema
>;

export const SingleIssueUpdateResponseSchema = z.union([
  IssueListItemSchema,
  z.object({ issue: IssueListItemSchema }).transform((v) => v.issue),
]);

export const TrackerTriageUrgencySchema = z.enum(["high", "medium", "low"]);
export type TrackerTriageUrgency = z.infer<typeof TrackerTriageUrgencySchema>;

export const TrackerTriageImpactSchema = z.enum(["high", "medium", "low"]);
export type TrackerTriageImpact = z.infer<typeof TrackerTriageImpactSchema>;

export const TrackerTriageEffortSchema = z.enum(["xs", "s", "m", "l", "xl"]);
export type TrackerTriageEffort = z.infer<typeof TrackerTriageEffortSchema>;

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

export const StacktraceJsonResponseSchema = z.record(z.string(), z.unknown());
