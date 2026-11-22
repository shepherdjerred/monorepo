import { z } from "zod";
import {
  clusterFacetShape,
  monorepoFacetShape,
  observabilityFacetShape,
  temporalFacetShape,
} from "./platform-shapes.ts";
import {
  bugsinkFacetShape,
  cloudflareFacetShape,
  fliptFacetShape,
  gitHubFacetShape,
  gitHubRateLimitBucketShape,
  golinkFacetShape,
  postHogFacetShape,
  tailscaleFacetShape,
  trackerFacetShape,
} from "./service-shapes.ts";

export const FACET_KEYS = [
  "renovate",
  "github",
  "posthog",
  "bugsink",
  "flipt",
  "tracker",
  "cloudflare",
  "tailscale",
  "golink",
  "monorepo",
  "cluster",
  "observability",
  "temporal",
] as const;
export const FacetKeySchema = z.enum(FACET_KEYS);
export type FacetKey = z.infer<typeof FacetKeySchema>;

const StringCountMapSchema = z.record(z.string(), z.number());

/** Renovate dependency dashboard & version-delta enrichment. */
export const RENOVATE_UPDATE_STATES = [
  "awaiting-approval",
  "pending-checks",
  "rate-limited",
  "awaiting-schedule",
  "errored",
  "edited-blocked",
  "ignored",
] as const;
export const RenovateUpdateStateSchema = z.enum(RENOVATE_UPDATE_STATES);
export type RenovateUpdateState = z.infer<typeof RenovateUpdateStateSchema>;

export const RENOVATE_IMPACT_LEVELS = [
  "none",
  "low",
  "medium",
  "high",
  "breaking",
] as const;
export const RenovateImpactLevelSchema = z.enum(RENOVATE_IMPACT_LEVELS);
export type RenovateImpactLevel = z.infer<typeof RenovateImpactLevelSchema>;

export const RENOVATE_EVIDENCE_SOURCES = [
  "github-releases",
  "github-compare",
  "registry-metadata",
  "pr-body",
  "none",
] as const;
export const RenovateEvidenceSourceSchema = z.enum(RENOVATE_EVIDENCE_SOURCES);
export type RenovateEvidenceSource = z.infer<
  typeof RenovateEvidenceSourceSchema
>;

export const RENOVATE_UPDATE_TYPES = [
  "major",
  "minor",
  "patch",
  "digest",
  "pin",
  "unknown",
] as const;
export const RenovateUpdateTypeSchema = z.enum(RENOVATE_UPDATE_TYPES);
export type RenovateUpdateType = z.infer<typeof RenovateUpdateTypeSchema>;

export const RenovateVersionDeltaSchema = z.object({
  cacheKey: z.string(),
  generatedAt: z.iso.datetime(),
  runningVersion: z.string().nullable(),
  pinnedVersion: z.string().nullable(),
  targetVersion: z.string(),
  effectiveFromVersion: z.string().nullable(),
  versionsBehindCount: z.number().nullable(),
  summary: z.string(),
  impactLevel: RenovateImpactLevelSchema,
  breakingChanges: z.array(z.string()),
  highlights: z.array(z.string()),
  repoRelevance: z.string(),
  evidenceSource: RenovateEvidenceSourceSchema,
  compareUrl: z.string().optional(),
  releaseUrls: z.array(z.string()),
});
export type RenovateVersionDelta = z.infer<typeof RenovateVersionDeltaSchema>;

export const RenovateItemSchema = z.object({
  id: z.string(),
  branch: z.string(),
  title: z.string(),
  packageName: z.string(),
  datasource: z.string().optional(),
  ecosystem: z.string(),
  updateType: RenovateUpdateTypeSchema,
  state: RenovateUpdateStateSchema,
  checked: z.boolean(),
  prNumber: z.number().optional(),
  prUrl: z.string().optional(),
  checks: z.string().optional(),
  exactHeadApproved: z.boolean().optional(),
  mergeable: z.string().optional(),
  halfUpgrade: z.boolean().optional(),
  runningVersion: z.string().nullable().optional(),
  pinnedVersion: z.string().nullable().optional(),
  targetVersion: z.string().nullable().optional(),
  consumers: z.array(z.string()).default([]),
  delta: RenovateVersionDeltaSchema.optional(),
});
export type RenovateItem = z.infer<typeof RenovateItemSchema>;
export type RenovateItemInput = z.input<typeof RenovateItemSchema>;

export const RenovateFacetSchema = z.object({
  issueNumber: z.number().nullable(),
  issueUrl: z.string().optional(),
  truncated: z.boolean(),
  lookupWarnings: z.array(z.string()),
  deprecations: z.array(
    z.object({
      current: z.string(),
      replacement: z.string().nullable(),
      notes: z.string().optional(),
    }),
  ),
  counts: z.record(RenovateUpdateStateSchema, z.number()),
  openPrCount: z.number(),
  prConcurrentLimit: z.number().default(3),
  merged7dCount: z.number(),
  merged30dCount: z.number(),
  medianMergeHours: z.number().nullable(),
  llmEnrichedCount: z.number(),
  llmBreakingCount: z.number(),
  ecosystemCounts: StringCountMapSchema,
  updateTypeCounts: StringCountMapSchema,
  items: z.array(RenovateItemSchema),
  recentMerged: z.array(
    z.object({
      number: z.number(),
      title: z.string(),
      url: z.string(),
      mergedAt: z.string(),
      branch: z.string().optional(),
    }),
  ),
});
export type RenovateFacet = z.infer<typeof RenovateFacetSchema>;
export type RenovateFacetInput = z.input<typeof RenovateFacetSchema>;
export type RenovateDeprecation = RenovateFacet["deprecations"][number];
export type RenovateRecentMerged = RenovateFacet["recentMerged"][number];

/** GitHub PR queue, recent merges, and API rate limits. */
export const GitHubRateLimitBucketSchema = z.object(gitHubRateLimitBucketShape);
export type GitHubRateLimitBucket = z.infer<typeof GitHubRateLimitBucketSchema>;
export const GitHubFacetSchema = z.object(gitHubFacetShape);
export type GitHubFacet = z.infer<typeof GitHubFacetSchema>;
export type GitHubOpenPr = GitHubFacet["openPrs"][number];
export type GitHubMergedPr = GitHubFacet["merged7d"][number];

/** PostHog traffic, web vitals, exceptions, and funnels. */
export const PostHogFacetSchema = z.object(postHogFacetShape);
export type PostHogFacet = z.infer<typeof PostHogFacetSchema>;
export type PostHogSite = PostHogFacet["sites"][number];
export type PostHogTopPage = PostHogFacet["topPages"][number];
export type PostHogTopReferrer = PostHogFacet["topReferrers"][number];
export type PostHogFunnel = PostHogFacet["funnels"][number];
export type PostHogFunnelStep = PostHogFunnel["steps"][number];

/** Bugsink projects and top unresolved error issues. */
export const BugsinkFacetSchema = z.object(bugsinkFacetShape);
export type BugsinkFacet = z.infer<typeof BugsinkFacetSchema>;
export type BugsinkProjectSummary = BugsinkFacet["projects"][number];
export type BugsinkTopIssue = BugsinkFacet["topIssues"][number];

/** Flipt managed inventory, drift status, and default-off exceptions. */
export const FliptNamespaceStatusSchema = z.enum([
  "ok",
  "drift",
  "missing",
  "unknown",
]);
export type FliptNamespaceStatus = z.infer<typeof FliptNamespaceStatusSchema>;
export const FliptFacetSchema = z.object(fliptFacetShape);
export type FliptFacet = z.infer<typeof FliptFacetSchema>;
export type FliptNamespaceSummary = FliptFacet["namespaces"][number];
export type FliptFlagSummary = FliptFacet["flags"][number];

/** Tracker open work, triage queue, active Forum notices, and projects. */
export const TrackerFacetSchema = z.object(trackerFacetShape);
export type TrackerFacet = z.infer<typeof TrackerFacetSchema>;
export type TrackerNotice = TrackerFacet["activeNotices"][number];
export type TrackerProjectSummary = TrackerFacet["projects"][number];
export type TrackerUrgentIssue = TrackerFacet["urgentIssues"][number];

/** Cloudflare domains, email/DNS security posture, R2 buckets, and tunnels. */
export const CloudflareCheckStatusSchema = z.enum(["ok", "warn", "missing"]);
export type CloudflareCheckStatus = z.infer<typeof CloudflareCheckStatusSchema>;
export const CloudflareFacetSchema = z.object(cloudflareFacetShape);
export type CloudflareFacet = z.infer<typeof CloudflareFacetSchema>;
export type CloudflareDomain = CloudflareFacet["domains"][number];
export type CloudflareR2Bucket = CloudflareFacet["r2Buckets"][number];
export type CloudflareTunnelRoute = CloudflareFacet["tunnelRoutes"][number];

/** Tailscale tailnet devices, key expiry, and cluster ingress services. */
export const TailscaleFacetSchema = z.object(tailscaleFacetShape);
export type TailscaleFacet = z.infer<typeof TailscaleFacetSchema>;
export type TailscaleDevice = TailscaleFacet["devices"][number];

/** Golink shortlinks across manual and dynamic resolution tiers. */
export const GolinkFacetSchema = z.object(golinkFacetShape);
export type GolinkFacet = z.infer<typeof GolinkFacetSchema>;
export type GolinkLink = GolinkFacet["links"][number];

/** Monorepo workspace packages, Turborepo cache performance, and audits. */
export const MonorepoAuditStatusSchema = z.enum([
  "ok",
  "warning",
  "error",
  "unknown",
]);
export type MonorepoAuditStatus = z.infer<typeof MonorepoAuditStatusSchema>;
export const MonorepoFacetSchema = z.object(monorepoFacetShape);
export type MonorepoFacet = z.infer<typeof MonorepoFacetSchema>;
export type MonorepoPackage = MonorepoFacet["packages"][number];
export type MonorepoExpensiveTask = MonorepoFacet["expensiveTasks"][number];
export type MonorepoAudit = MonorepoFacet["audits"][number];

/** Cluster nodes, workloads, databases, ZFS/NVMe storage, SeaweedFS, ArgoCD. */
export const ClusterDatabaseEngineSchema = z.enum(["postgres", "mariadb"]);
export type ClusterDatabaseEngine = z.infer<typeof ClusterDatabaseEngineSchema>;
export const ClusterFacetSchema = z.object(clusterFacetShape);
export type ClusterFacet = z.infer<typeof ClusterFacetSchema>;
export type ClusterNode = ClusterFacet["nodes"][number];
export type ClusterWorkloadSummary = ClusterFacet["workloadSummary"];
export type ClusterWorkload = ClusterFacet["workloads"][number];
export type ClusterDatabase = ClusterFacet["databases"][number];
export type ClusterZpool = ClusterFacet["zpools"][number];
export type ClusterNvmeDrive = ClusterFacet["nvmeDrives"][number];
export type ClusterSeaweedfs = ClusterFacet["seaweedfs"];
export type ClusterArgoApp = ClusterFacet["argoApps"][number];

/** Observability stack health across Prometheus, Loki, Tempo, and Grafana. */
export const ObservabilityFacetSchema = z.object(observabilityFacetShape);
export type ObservabilityFacet = z.infer<typeof ObservabilityFacetSchema>;
export type ObservabilityPrometheus = ObservabilityFacet["prometheus"];
export type ObservabilityLoki = ObservabilityFacet["loki"];
export type ObservabilityTempo = ObservabilityFacet["tempo"];
export type ObservabilityGrafana = ObservabilityFacet["grafana"];
export type ObservabilityGrafanaDashboard =
  ObservabilityGrafana["dashboards"][number];

/** Temporal worker pools and declarative schedule fleet health. */
export const TemporalFacetSchema = z.object(temporalFacetShape);
export type TemporalFacet = z.infer<typeof TemporalFacetSchema>;
export type TemporalWorkerPool = TemporalFacet["workerPools"][number];
export type TemporalScheduleSummary = TemporalFacet["scheduleSummary"];
export type TemporalScheduleItem = TemporalFacet["schedules"][number];

export const FACET_SCHEMAS = {
  renovate: RenovateFacetSchema,
  github: GitHubFacetSchema,
  posthog: PostHogFacetSchema,
  bugsink: BugsinkFacetSchema,
  flipt: FliptFacetSchema,
  tracker: TrackerFacetSchema,
  cloudflare: CloudflareFacetSchema,
  tailscale: TailscaleFacetSchema,
  golink: GolinkFacetSchema,
  monorepo: MonorepoFacetSchema,
  cluster: ClusterFacetSchema,
  observability: ObservabilityFacetSchema,
  temporal: TemporalFacetSchema,
} as const satisfies Record<FacetKey, z.ZodType>;
export type FacetSchemaMap = typeof FACET_SCHEMAS;
export type FacetByKey = {
  [K in FacetKey]: z.infer<FacetSchemaMap[K]>;
};

export const OpsFacetsSchema = z.object({
  renovate: RenovateFacetSchema.optional(),
  github: GitHubFacetSchema.optional(),
  posthog: PostHogFacetSchema.optional(),
  bugsink: BugsinkFacetSchema.optional(),
  flipt: FliptFacetSchema.optional(),
  tracker: TrackerFacetSchema.optional(),
  cloudflare: CloudflareFacetSchema.optional(),
  tailscale: TailscaleFacetSchema.optional(),
  golink: GolinkFacetSchema.optional(),
  monorepo: MonorepoFacetSchema.optional(),
  cluster: ClusterFacetSchema.optional(),
  observability: ObservabilityFacetSchema.optional(),
  temporal: TemporalFacetSchema.optional(),
});
export type OpsFacets = z.infer<typeof OpsFacetsSchema>;
export type OpsFacetsInput = z.input<typeof OpsFacetsSchema>;

export function parseOpsFacets(value: unknown): OpsFacets {
  return OpsFacetsSchema.parse(value);
}
