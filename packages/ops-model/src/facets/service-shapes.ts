import { z } from "zod";

const StringCountMapSchema = z.record(z.string(), z.number());

export const gitHubRateLimitBucketShape = {
  used: z.number(),
  limit: z.number(),
  remaining: z.number(),
  resetAt: z.string(),
};

const GitHubRateLimitBucketInternalSchema = z.object(
  gitHubRateLimitBucketShape,
);

export const gitHubFacetShape = {
  openPrs: z.array(
    z.object({
      number: z.number(),
      title: z.string(),
      url: z.string(),
      authorLogin: z.string(),
      authorKind: z.string(),
      draft: z.boolean(),
      createdAt: z.string(),
      updatedAt: z.string(),
      ageHours: z.number(),
      branch: z.string(),
      baseRefName: z.string(),
      checks: z.string(),
      reviewDecision: z.string().nullable(),
      exactHeadApproved: z.boolean(),
      mergeable: z.string(),
      labels: z.array(z.string()),
      isRenovate: z.boolean(),
    }),
  ),
  merged7d: z.array(
    z.object({
      number: z.number(),
      title: z.string(),
      url: z.string(),
      authorLogin: z.string(),
      mergedAt: z.string(),
      branch: z.string().optional(),
    }),
  ),
  mergesByAuthor7d: StringCountMapSchema,
  rateLimits: z.object({
    graphql: GitHubRateLimitBucketInternalSchema.nullable(),
    core: GitHubRateLimitBucketInternalSchema.nullable(),
  }),
};

export const postHogFacetShape = {
  totalPageviews24h: z.number(),
  totalDau24h: z.number(),
  totalWau7d: z.number(),
  totalExceptions24h: z.number(),
  sites: z.array(
    z.object({
      siteKey: z.string().nullable(),
      host: z.string(),
      pageviews24h: z.number(),
      dau24h: z.number(),
      wau7d: z.number(),
      dailySeries7d: z.array(z.number()),
      p75LcpMs: z.number().nullable(),
      p75InpMs: z.number().nullable(),
      exceptions24h: z.number(),
      rageclicks24h: z.number(),
    }),
  ),
  topPages: z.array(
    z.object({ host: z.string(), path: z.string(), pageviews24h: z.number() }),
  ),
  topReferrers: z.array(
    z.object({ referrer: z.string(), pageviews24h: z.number() }),
  ),
  funnels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      steps: z.array(
        z.object({
          label: z.string(),
          count24h: z.number(),
          count7d: z.number(),
        }),
      ),
    }),
  ),
};

export const bugsinkFacetShape = {
  totalUnresolved: z.number(),
  totalDigestedEvents: z.number(),
  projects: z.array(
    z.object({
      id: z.number(),
      slug: z.string(),
      name: z.string(),
      url: z.string(),
      activeIssues7d: z.number(),
      staleIssues: z.number(),
      mutedIssues: z.number(),
      digestedEventsTotal: z.number(),
      topIssueTitle: z.string().optional(),
    }),
  ),
  topIssues: z.array(
    z.object({
      id: z.string(),
      projectSlug: z.string(),
      type: z.string(),
      value: z.string(),
      transaction: z.string(),
      events: z.number(),
      firstSeen: z.string(),
      lastSeen: z.string(),
      muted: z.boolean(),
      url: z.string(),
    }),
  ),
};

const FliptNamespaceStatusInternalSchema = z.enum([
  "ok",
  "drift",
  "missing",
  "unknown",
]);

export const fliptFacetShape = {
  totalFlags: z.number(),
  prodEnabledCount: z.number(),
  betaEnabledCount: z.number(),
  defaultOffExceptionsCount: z.number(),
  overdueExceptionsCount: z.number(),
  namespaces: z.array(
    z.object({
      namespace: z.string(),
      name: z.string(),
      flagCount: z.number(),
      prodStatus: FliptNamespaceStatusInternalSchema,
      betaStatus: FliptNamespaceStatusInternalSchema,
    }),
  ),
  flags: z.array(
    z.object({
      namespace: z.string(),
      key: z.string(),
      prodEnabled: z.boolean(),
      betaEnabled: z.boolean(),
      defaultOffReason: z.string().optional(),
      reviewBy: z.string().optional(),
    }),
  ),
};

export const trackerFacetShape = {
  openByTeam: StringCountMapSchema,
  triageCount: z.number(),
  completed7dCount: z.number(),
  activeNotices: z.array(
    z.object({
      identifier: z.string(),
      kind: z.string(),
      title: z.string(),
      owner: z.string().nullable(),
      scopes: z.array(z.string()),
      updatedAt: z.string(),
      url: z.string(),
    }),
  ),
  projects: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      team: z.string(),
      openCount: z.number(),
      completed7dCount: z.number(),
    }),
  ),
  urgentIssues: z.array(
    z.object({
      identifier: z.string(),
      title: z.string(),
      team: z.string(),
      urgency: z.string(),
      impact: z.string(),
      assignee: z.string().nullable(),
      url: z.string(),
    }),
  ),
};

const CloudflareCheckStatusInternalSchema = z.enum(["ok", "warn", "missing"]);

export const cloudflareFacetShape = {
  domains: z.array(
    z.object({
      domain: z.string(),
      zoneId: z.string().nullable(),
      registrarExpiryDays: z.number().nullable(),
      dnssec: CloudflareCheckStatusInternalSchema,
      spf: CloudflareCheckStatusInternalSchema,
      dmarc: CloudflareCheckStatusInternalSchema,
      mx: CloudflareCheckStatusInternalSchema,
      mtaSts: CloudflareCheckStatusInternalSchema,
      tls: CloudflareCheckStatusInternalSchema,
      recordCount: z.number(),
    }),
  ),
  r2Buckets: z.array(
    z.object({
      name: z.string(),
      storageBytes: z.number(),
      objectCount: z.number(),
      classAOpsMonth: z.number().nullable(),
      classBOpsMonth: z.number().nullable(),
    }),
  ),
  tunnelRoutes: z.array(
    z.object({ hostname: z.string(), service: z.string(), status: z.string() }),
  ),
};

export const tailscaleFacetShape = {
  totalDevices: z.number(),
  onlineDevices: z.number(),
  expiringKeysSoon: z.number(),
  clusterServicesCount: z.number(),
  devices: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      hostname: z.string(),
      os: z.string(),
      clientVersion: z.string(),
      updateAvailable: z.boolean(),
      online: z.boolean(),
      lastSeen: z.string().nullable(),
      expiresAt: z.string().nullable(),
      daysToExpiry: z.number().nullable(),
      tags: z.array(z.string()),
      addresses: z.array(z.string()),
    }),
  ),
};

export const golinkFacetShape = {
  totalLinks: z.number(),
  countsByTier: StringCountMapSchema,
  links: z.array(
    z.object({
      slug: z.string(),
      targetUrl: z.string(),
      tier: z.string(),
      clicks: z.number().nullable(),
      shadows: z.array(z.string()).optional(),
    }),
  ),
};
