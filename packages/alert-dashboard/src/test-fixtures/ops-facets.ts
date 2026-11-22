import {
  parseOpsFacets,
  type OpsFacets,
  type PostHogSite,
} from "@shepherdjerred/ops-model/facets.ts";
import { CLUSTER_FIXTURE_FACETS } from "./ops-facets-cluster.ts";
import { PLATFORM_FIXTURE_FACETS } from "./ops-facets-platform.ts";

const GITHUB_REPO = "https://github.com/shepherdjerred/monorepo";
const BUGSINK_BASE = "https://bugsink.sjer.red";

const POSTHOG_SITE_TUPLES = [
  ["sjer-red", "sjer.red", 1840, 612, 3410, 1180, 48, 2, 1],
  ["scout-prod", "scout.sjer.red", 1420, 388, 1960, 1640, 92, 6, 4],
  ["ts-mc", "ts-mc.net", 960, 294, 1520, 1390, 64, 1, 2],
  ["wiki", "wiki.sjer.red", 780, 215, 1180, 940, 36, 0, 0],
  [
    "better-skill-capped",
    "betterskillcapped.com",
    690,
    241,
    1340,
    1520,
    78,
    3,
    1,
  ],
  ["cook", "cook.sjer.red", 510, 164, 890, 1080, 42, 0, 0],
  ["resume", "resume.sjer.red", 430, 198, 920, 820, 28, 0, 0],
  ["arcade", "arcade.sjer.red", 385, 112, 610, 1890, 116, 4, 3],
  ["stocks", "stocks.sjer.red", 310, 89, 470, 1460, 74, 1, 0],
  ["streambot", "streambot.sjer.red", 275, 76, 390, 1310, 58, 1, 0],
  ["webring", "webring.sjer.red", 190, 84, 410, 760, 24, 0, 0],
  ["glitter-boys-ppl", "ppl.glitterboys.org", 145, 42, 205, 1120, 52, 0, 0],
  ["scout-beta", "beta.scout.sjer.red", 95, 18, 64, 1710, 88, 2, 0],
  ["landing-pages", "glitterboys.org", 68, 29, 140, 910, 31, 0, 0],
] as const;

const posthogSites: PostHogSite[] = POSTHOG_SITE_TUPLES.map(
  (
    [
      siteKey,
      host,
      pageviews24h,
      dau24h,
      wau7d,
      p75LcpMs,
      p75InpMs,
      exceptions24h,
      rageclicks24h,
    ],
    idx,
  ) => ({
    siteKey,
    host,
    pageviews24h,
    dau24h,
    wau7d,
    dailySeries7d: Array.from({ length: 7 }, (_, day) =>
      Math.max(
        10,
        Math.round(pageviews24h * (0.78 + Math.sin((day + idx) * 0.9) * 0.24)),
      ),
    ),
    p75LcpMs,
    p75InpMs,
    exceptions24h,
    rageclicks24h,
  }),
);

function openPr(
  number: number,
  title: string,
  meta: {
    authorLogin: string;
    authorKind: string;
    draft: boolean;
    ageHours: number;
    branch: string;
    baseRefName: string;
    checks: string;
    reviewDecision: string | null;
    exactHeadApproved: boolean;
    labels: string[];
    isRenovate: boolean;
  },
) {
  return {
    number,
    title,
    url: `${GITHUB_REPO}/pull/${String(number)}`,
    createdAt: "2026-11-21T18:00:00Z",
    updatedAt: "2026-11-21T22:10:00Z",
    mergeable: "MERGEABLE",
    ...meta,
  };
}

/** Rich, schema-validated sample facets across all 13 Hub 2.0 facet keys. */
export const FIXTURE_OPS_FACETS: OpsFacets = parseOpsFacets({
  renovate: {
    issueNumber: 1,
    issueUrl: `${GITHUB_REPO}/issues/1`,
    truncated: false,
    lookupWarnings: [],
    deprecations: [
      {
        current: "@opentelemetry/sdk-metrics@1.30.0",
        replacement: "@opentelemetry/sdk-metrics@2.x",
        notes: "v1 metric reader registration is deprecated upstream",
      },
    ],
    counts: {
      "awaiting-approval": 18,
      "pending-checks": 4,
      "rate-limited": 3,
      "awaiting-schedule": 2,
      errored: 1,
      "edited-blocked": 1,
      ignored: 0,
    },
    openPrCount: 3,
    prConcurrentLimit: 3,
    merged7dCount: 29,
    merged30dCount: 114,
    medianMergeHours: 2.4,
    llmEnrichedCount: 2,
    llmBreakingCount: 1,
    ecosystemCounts: { npm: 16, docker: 7, helm: 5, "github-actions": 1 },
    updateTypeCounts: { major: 4, minor: 15, patch: 8, digest: 2 },
    items: [
      {
        id: "renovate:prisma-8",
        branch: "renovate/prisma-8.x",
        title: "chore(deps): update prisma monorepo to v8 (major)",
        packageName: "prisma",
        datasource: "npm",
        ecosystem: "npm",
        updateType: "major",
        state: "awaiting-approval",
        checked: false,
        runningVersion: "7.10.0",
        pinnedVersion: "7.10.0",
        targetVersion: "8.0.0",
        consumers: ["alert-dashboard", "delivery", "golink", "scout-for-lol"],
        delta: {
          cacheKey: "npm:prisma:7.10.0->8.0.0",
          generatedAt: "2026-11-21T20:00:00Z",
          runningVersion: "7.10.0",
          pinnedVersion: "7.10.0",
          targetVersion: "8.0.0",
          effectiveFromVersion: "7.10.0",
          versionsBehindCount: 3,
          summary:
            "Drops legacy Rust query engine fallback in favor of driver adapters and tightens Json null typing.",
          impactLevel: "breaking",
          breakingChanges: [
            "PrismaClient constructor requires an explicit driver adapter in all runtimes",
            "Json filter `equals: null` requires DbNull or JsonNull sentinel",
          ],
          highlights: [
            "22% lower SQLite transaction overhead under PrismaLibSql",
          ],
          repoRelevance:
            "alert-dashboard and delivery already pass driver adapters; audit Json filter call sites.",
          evidenceSource: "github-releases",
          compareUrl: "https://github.com/prisma/prisma/compare/7.10.0...8.0.0",
          releaseUrls: ["https://github.com/prisma/prisma/releases/tag/8.0.0"],
        },
      },
      {
        id: "renovate:hono-4.13",
        branch: "renovate/hono-4.x",
        title: "chore(deps): update dependency hono to v4.13.2",
        packageName: "hono",
        datasource: "npm",
        ecosystem: "npm",
        updateType: "minor",
        state: "pending-checks",
        checked: true,
        prNumber: 4812,
        prUrl: `${GITHUB_REPO}/pull/4812`,
        checks: "PENDING",
        exactHeadApproved: true,
        mergeable: "MERGEABLE",
        runningVersion: "4.12.18",
        pinnedVersion: "4.12.18",
        targetVersion: "4.13.2",
        consumers: ["alert-dashboard", "delivery", "golink", "storm-brain"],
        delta: {
          cacheKey: "npm:hono:4.12.18->4.13.2",
          generatedAt: "2026-11-21T20:05:00Z",
          runningVersion: "4.12.18",
          pinnedVersion: "4.12.18",
          targetVersion: "4.13.2",
          effectiveFromVersion: "4.12.18",
          versionsBehindCount: 2,
          summary:
            "Adds streaming SSE keepalive helpers and fixes bodyLimit abort propagation under Bun.serve.",
          impactLevel: "low",
          breakingChanges: [],
          highlights: ["Fixes request AbortSignal forwarding on early close"],
          repoRelevance:
            "Directly benefits Hub /api/v1/ops/series cancellation under Bun.",
          evidenceSource: "github-releases",
          releaseUrls: ["https://github.com/honojs/hono/releases/tag/v4.13.2"],
        },
      },
      {
        id: "renovate:loki-helm",
        branch: "renovate/loki-6.x",
        title: "chore(deps): update helm release loki to v6.24.0",
        packageName: "loki",
        datasource: "helm",
        ecosystem: "helm",
        updateType: "minor",
        state: "errored",
        checked: true,
        prNumber: 4809,
        prUrl: `${GITHUB_REPO}/pull/4809`,
        checks: "FAILURE",
        exactHeadApproved: false,
        mergeable: "CONFLICTING",
        halfUpgrade: true,
        runningVersion: "6.21.0",
        pinnedVersion: "6.22.0",
        targetVersion: "6.24.0",
        consumers: ["homelab"],
      },
    ],
    recentMerged: [
      {
        number: 4805,
        title: "chore(deps): update dependency uplot to v1.6.32",
        url: `${GITHUB_REPO}/pull/4805`,
        mergedAt: "2026-11-21T16:10:00Z",
        branch: "renovate/uplot-1.x",
      },
      {
        number: 4801,
        title: "chore(deps): update prom/prometheus docker tag to v3.3.1",
        url: `${GITHUB_REPO}/pull/4801`,
        mergedAt: "2026-11-20T22:40:00Z",
        branch: "renovate/prom-prometheus-3.x",
      },
    ],
  },
  github: {
    openPrs: [
      openPr(
        4815,
        "feat(hub): add OpsFacet storage and PromQL series presets",
        {
          authorLogin: "shepherdjerred",
          authorKind: "human",
          draft: false,
          ageHours: 4.5,
          branch: "hub-2-facets-backend",
          baseRefName: "main",
          checks: "SUCCESS",
          reviewDecision: "APPROVED",
          exactHeadApproved: true,
          labels: ["hub", "platform"],
          isRenovate: false,
        },
      ),
      openPr(4816, "feat(hub): engineering, product, and cluster facet pages", {
        authorLogin: "shepherdjerred",
        authorKind: "human",
        draft: false,
        ageHours: 3.2,
        branch: "hub-2-facet-pages",
        baseRefName: "hub-2-facets-backend",
        checks: "PENDING",
        reviewDecision: null,
        exactHeadApproved: false,
        labels: ["hub", "ui"],
        isRenovate: false,
      }),
      openPr(4817, "test(hub): add Playwright visual coverage for Hub 2.0", {
        authorLogin: "shepherdjerred",
        authorKind: "human",
        draft: true,
        ageHours: 2,
        branch: "hub-2-playwright",
        baseRefName: "hub-2-facet-pages",
        checks: "PENDING",
        reviewDecision: null,
        exactHeadApproved: false,
        labels: ["hub", "e2e"],
        isRenovate: false,
      }),
      openPr(4812, "chore(deps): update dependency hono to v4.13.2", {
        authorLogin: "renovate[bot]",
        authorKind: "renovate",
        draft: false,
        ageHours: 8.5,
        branch: "renovate/hono-4.x",
        baseRefName: "main",
        checks: "PENDING",
        reviewDecision: "APPROVED",
        exactHeadApproved: true,
        labels: ["dependencies"],
        isRenovate: true,
      }),
    ],
    merged7d: [
      {
        number: 4810,
        title: "feat(ops-model): define 13 Hub 2.0 facet schemas",
        url: `${GITHUB_REPO}/pull/4810`,
        authorLogin: "shepherdjerred",
        mergedAt: "2026-11-21T17:30:00Z",
        branch: "ops-model-facets",
      },
      {
        number: 4805,
        title: "chore(deps): update dependency uplot to v1.6.32",
        url: `${GITHUB_REPO}/pull/4805`,
        authorLogin: "renovate[bot]",
        mergedAt: "2026-11-21T16:10:00Z",
        branch: "renovate/uplot-1.x",
      },
    ],
    mergesByAuthor7d: { human: 19, renovate: 29, agent: 8 },
    rateLimits: {
      graphql: {
        used: 812,
        limit: 5000,
        remaining: 4188,
        resetAt: "2026-11-21T23:00:00Z",
      },
      core: {
        used: 340,
        limit: 5000,
        remaining: 4660,
        resetAt: "2026-11-21T23:00:00Z",
      },
    },
  },
  posthog: {
    totalPageviews24h: posthogSites.reduce(
      (sum, site) => sum + site.pageviews24h,
      0,
    ),
    totalDau24h: posthogSites.reduce((sum, site) => sum + site.dau24h, 0),
    totalWau7d: posthogSites.reduce((sum, site) => sum + site.wau7d, 0),
    totalExceptions24h: posthogSites.reduce(
      (sum, site) => sum + site.exceptions24h,
      0,
    ),
    sites: posthogSites,
    topPages: [
      { host: "sjer.red", path: "/blog/homelab-talos-zfs", pageviews24h: 640 },
      { host: "scout.sjer.red", path: "/leaderboard", pageviews24h: 520 },
      { host: "ts-mc.net", path: "/bluemap", pageviews24h: 410 },
      {
        host: "wiki.sjer.red",
        path: "/architecture/delivery",
        pageviews24h: 315,
      },
    ],
    topReferrers: [
      { referrer: "news.ycombinator.com", pageviews24h: 720 },
      { referrer: "discord.com", pageviews24h: 615 },
      { referrer: "google.com", pageviews24h: 490 },
      { referrer: "github.com", pageviews24h: 280 },
    ],
    funnels: [
      {
        id: "scout-onboarding",
        name: "Scout Discord onboarding",
        steps: [
          { label: "Landing view", count24h: 340, count7d: 2140 },
          { label: "Bot authorized", count24h: 96, count7d: 620 },
          { label: "First player subscribed", count24h: 71, count7d: 465 },
          { label: "First postmatch card posted", count24h: 64, count7d: 418 },
        ],
      },
      {
        id: "storm-join",
        name: "The Storm player activation",
        steps: [
          { label: "Site visit", count24h: 290, count7d: 1520 },
          { label: "Server address copied", count24h: 118, count7d: 640 },
          { label: "First survival login", count24h: 54, count7d: 312 },
        ],
      },
    ],
  },
  bugsink: {
    totalUnresolved: 9,
    totalDigestedEvents: 14_820,
    projects: [
      {
        id: 1,
        slug: "scout-for-lol",
        name: "Scout for LoL",
        url: `${BUGSINK_BASE}/projects/1/`,
        activeIssues7d: 4,
        staleIssues: 1,
        mutedIssues: 2,
        digestedEventsTotal: 8420,
        topIssueTitle: "RiotUpstreamTimeoutError: /lol/match/v5 timed out",
      },
      {
        id: 2,
        slug: "birmel",
        name: "Birmel",
        url: `${BUGSINK_BASE}/projects/2/`,
        activeIssues7d: 2,
        staleIssues: 0,
        mutedIssues: 1,
        digestedEventsTotal: 3910,
        topIssueTitle:
          "TypeError: Cannot read properties of undefined (reading 'guild')",
      },
      {
        id: 3,
        slug: "tasknotes-api",
        name: "TaskNotes API",
        url: `${BUGSINK_BASE}/projects/3/`,
        activeIssues7d: 2,
        staleIssues: 0,
        mutedIssues: 0,
        digestedEventsTotal: 2490,
      },
    ],
    topIssues: [
      {
        id: "1882",
        projectSlug: "birmel",
        type: "TypeError",
        value: "Cannot read properties of undefined (reading 'guild')",
        transaction: "discord.voiceStateUpdate",
        events: 42,
        firstSeen: "2026-11-20T14:12:00Z",
        lastSeen: "2026-11-21T21:40:00Z",
        muted: false,
        url: `${BUGSINK_BASE}/issues/issue/1882/`,
      },
      {
        id: "1904",
        projectSlug: "scout-for-lol",
        type: "RiotUpstreamTimeoutError",
        value:
          "GET /lol/match/v5/matches/NA1_5189920144 timed out after 10000ms",
        transaction: "pollPostmatchHistory",
        events: 19,
        firstSeen: "2026-11-21T08:05:00Z",
        lastSeen: "2026-11-21T20:55:00Z",
        muted: false,
        url: `${BUGSINK_BASE}/issues/issue/1904/`,
      },
    ],
  },
  ...PLATFORM_FIXTURE_FACETS,
  ...CLUSTER_FIXTURE_FACETS,
});
