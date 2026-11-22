import { describe, expect, it } from "vitest";
import {
  BugsinkFacetSchema,
  CloudflareFacetSchema,
  ClusterFacetSchema,
  FACET_KEYS,
  FACET_SCHEMAS,
  FacetKeySchema,
  FliptFacetSchema,
  GitHubFacetSchema,
  GolinkFacetSchema,
  MonorepoFacetSchema,
  ObservabilityFacetSchema,
  OpsFacetsSchema,
  parseOpsFacets,
  PostHogFacetSchema,
  RenovateFacetSchema,
  RenovateImpactLevelSchema,
  RenovateItemSchema,
  RenovateUpdateStateSchema,
  RenovateVersionDeltaSchema,
  TailscaleFacetSchema,
  TemporalFacetSchema,
  TrackerFacetSchema,
  type OpsFacetsInput,
} from "./index.ts";
import { assembleSnapshot } from "@shepherdjerred/ops-model/assemble.ts";
import {
  OpsIngestSchema,
  SnapshotSchema,
} from "@shepherdjerred/ops-model/snapshot.ts";

function sampleDeliveryFacets(): Pick<
  Required<OpsFacetsInput>,
  "renovate" | "github" | "monorepo"
> {
  return {
    renovate: {
      issueNumber: 42,
      issueUrl: "https://github.com/shepherdjerred/monorepo/issues/42",
      truncated: false,
      lookupWarnings: ["Private registry timeout on chartmuseum"],
      deprecations: [
        {
          current: "@eslint/eslintrc",
          replacement: "@eslint/compat",
          notes: "Flat config replacement",
        },
      ],
      counts: {
        "awaiting-approval": 2,
        "pending-checks": 1,
        "rate-limited": 0,
        "awaiting-schedule": 0,
        errored: 1,
        "edited-blocked": 0,
        ignored: 3,
      },
      openPrCount: 2,
      merged7dCount: 5,
      merged30dCount: 19,
      medianMergeHours: 1.4,
      llmEnrichedCount: 1,
      llmBreakingCount: 1,
      ecosystemCounts: { npm: 4, helm: 3 },
      updateTypeCounts: { major: 2, minor: 3, patch: 2 },
      items: [
        {
          id: "renovate:zod-5",
          branch: "renovate/zod-5.x",
          title: "chore(deps): update dependency zod to v5",
          packageName: "zod",
          datasource: "npm",
          ecosystem: "npm",
          updateType: "major",
          state: "awaiting-approval",
          checked: false,
          runningVersion: "4.4.3",
          pinnedVersion: "4.4.3",
          targetVersion: "5.0.0",
          delta: {
            cacheKey: "npm:zod:4.4.3->5.0.0",
            generatedAt: "2026-11-21T20:00:00Z",
            runningVersion: "4.4.3",
            pinnedVersion: "4.4.3",
            targetVersion: "5.0.0",
            effectiveFromVersion: "4.4.3",
            versionsBehindCount: 1,
            summary: "Major release tightening record and date schemas.",
            impactLevel: "breaking",
            breakingChanges: [
              "z.string().datetime() removed in favor of z.iso",
            ],
            highlights: ["Smaller bundle footprint"],
            repoRelevance: "Used across ops-model and feature-flags.",
            evidenceSource: "github-releases",
            compareUrl:
              "https://github.com/colinhacks/zod/compare/v4.4.3...v5.0.0",
            releaseUrls: [
              "https://github.com/colinhacks/zod/releases/tag/v5.0.0",
            ],
          },
        },
      ],
      recentMerged: [
        {
          number: 9101,
          title: "chore(deps): update vitest to v5.0.3",
          url: "https://github.com/shepherdjerred/monorepo/pull/9101",
          mergedAt: "2026-11-20T12:00:00Z",
          branch: "renovate/vitest-5.x",
        },
      ],
    },
    github: {
      openPrs: [
        {
          number: 9200,
          title: "feat(hub): add Hub 2.0 facets",
          url: "https://github.com/shepherdjerred/monorepo/pull/9200",
          authorLogin: "derrej",
          authorKind: "agent",
          draft: false,
          createdAt: "2026-11-21T18:00:00Z",
          updatedAt: "2026-11-21T21:00:00Z",
          ageHours: 3.5,
          branch: "feat/hub-facets",
          baseRefName: "main",
          checks: "SUCCESS",
          reviewDecision: null,
          exactHeadApproved: false,
          mergeable: "MERGEABLE",
          labels: ["ops"],
          isRenovate: false,
        },
      ],
      merged7d: [
        {
          number: 9190,
          title: "fix(golink): tighten alias cache",
          url: "https://github.com/shepherdjerred/monorepo/pull/9190",
          authorLogin: "shepherdjerred",
          mergedAt: "2026-11-21T05:00:00Z",
        },
      ],
      mergesByAuthor7d: { shepherdjerred: 4, derrej: 11 },
      rateLimits: {
        graphql: {
          used: 420,
          limit: 5000,
          remaining: 4580,
          resetAt: "2026-11-21T23:00:00Z",
        },
        core: null,
      },
    },
    monorepo: {
      packageCount: 48,
      turboHitRatio7d: 0.91,
      turboSavedHours7d: 18.4,
      verifyRunsAnalyzed: 34,
      packages: [
        {
          name: "@shepherdjerred/ops-model",
          path: "packages/ops-model",
          category: "library",
          serviceId: null,
          hasExtendedTests: false,
          openPrCount: 1,
          renovatePendingCount: 0,
          bugsinkOpenCount: 0,
          flagCount: 0,
          cacheHitRatio: 0.95,
          medianDurationMs: 1200,
        },
      ],
      expensiveTasks: [
        {
          taskId: "@shepherdjerred/homelab#test",
          packageName: "@shepherdjerred/homelab",
          task: "test",
          hits: 29,
          misses: 5,
          hitRatio: 0.85,
          medianMissMs: 14_200,
          totalMissMinutes: 1.2,
        },
      ],
      catalogPinsCount: 92,
      audits: [
        {
          id: "flipt-drift",
          label: "Flipt declaration alignment",
          status: "ok",
          lastRunAt: "2026-11-21T21:30:00Z",
        },
      ],
    },
  };
}

function sampleProductFacets(): Pick<
  Required<OpsFacetsInput>,
  "posthog" | "bugsink" | "flipt" | "tracker"
> {
  return {
    posthog: {
      totalPageviews24h: 1840,
      totalDau24h: 310,
      totalWau7d: 1420,
      totalExceptions24h: 2,
      sites: [
        {
          siteKey: "sjer.red",
          host: "sjer.red",
          pageviews24h: 1200,
          dau24h: 240,
          wau7d: 1100,
          dailySeries7d: [150, 170, 160, 180, 190, 175, 175],
          p75LcpMs: 890,
          p75InpMs: 48,
          exceptions24h: 0,
          rageclicks24h: 1,
        },
      ],
      topPages: [{ host: "sjer.red", path: "/blog", pageviews24h: 410 }],
      topReferrers: [{ referrer: "news.ycombinator.com", pageviews24h: 220 }],
      funnels: [
        {
          id: "scout-onboarding",
          name: "Scout Onboarding",
          steps: [
            { label: "Landing", count24h: 80, count7d: 510 },
            { label: "Link Riot", count24h: 24, count7d: 140 },
          ],
        },
      ],
    },
    bugsink: {
      totalUnresolved: 3,
      totalDigestedEvents: 27,
      projects: [
        {
          id: 1,
          slug: "scout-prod",
          name: "Scout Prod",
          url: "https://bugsink.sjer.red/issues/1/",
          activeIssues7d: 2,
          staleIssues: 1,
          mutedIssues: 0,
          digestedEventsTotal: 27,
          topIssueTitle: "UpstreamError: Riot 429",
        },
      ],
      topIssues: [
        {
          id: "issue-1",
          projectSlug: "scout-prod",
          type: "UpstreamError",
          value: "Riot 429",
          transaction: "pollMatch",
          events: 19,
          firstSeen: "2026-11-20T00:00:00Z",
          lastSeen: "2026-11-21T21:00:00Z",
          muted: false,
          url: "https://bugsink.sjer.red/issues/issue/issue-1/event/last/",
        },
      ],
    },
    flipt: {
      totalFlags: 120,
      prodEnabledCount: 84,
      betaEnabledCount: 91,
      defaultOffExceptionsCount: 12,
      overdueExceptionsCount: 0,
      namespaces: [
        {
          namespace: "temporal",
          name: "Temporal",
          flagCount: 14,
          prodStatus: "ok",
          betaStatus: "ok",
        },
      ],
      flags: [
        {
          namespace: "temporal",
          key: "temporal-renovate-llm-delta-enabled",
          prodEnabled: true,
          betaEnabled: true,
        },
      ],
    },
    tracker: {
      openByTeam: { SJ: 9, AI: 18 },
      triageCount: 2,
      completed7dCount: 24,
      activeNotices: [
        {
          identifier: "FM-12",
          kind: "discussion",
          title: "Hub 2.0 rollout",
          owner: "derrej",
          scopes: ["alert-dashboard", "ops-model"],
          updatedAt: "2026-11-21T22:00:00Z",
          url: "https://tracker.tailnet-1a49.ts.net/forum/FM-12",
        },
      ],
      projects: [
        {
          slug: "devex",
          name: "Developer Experience",
          team: "AI",
          openCount: 7,
          completed7dCount: 5,
        },
      ],
      urgentIssues: [
        {
          identifier: "AI-601",
          title: "Unstick verify cache warming",
          team: "AI",
          urgency: "high",
          impact: "high",
          assignee: null,
          url: "https://tracker.tailnet-1a49.ts.net/issues/AI-601",
        },
      ],
    },
  };
}

function sampleNetworkFacets(): Pick<
  Required<OpsFacetsInput>,
  "cloudflare" | "tailscale" | "golink"
> {
  return {
    cloudflare: {
      domains: [
        {
          domain: "sjer.red",
          zoneId: "zone-123",
          registrarExpiryDays: 290,
          dnssec: "ok",
          spf: "ok",
          dmarc: "ok",
          mx: "ok",
          mtaSts: "ok",
          tls: "ok",
          recordCount: 38,
        },
      ],
      r2Buckets: [
        {
          name: "homelab-backups",
          storageBytes: 107_374_182_400,
          objectCount: 12_400,
          classAOpsMonth: 820,
          classBOpsMonth: 4100,
        },
      ],
      tunnelRoutes: [
        {
          hostname: "bugsink.sjer.red",
          service: "http://bugsink.bugsink.svc.cluster.local:8000",
          status: "healthy",
        },
      ],
    },
    tailscale: {
      totalDevices: 18,
      onlineDevices: 15,
      expiringKeysSoon: 0,
      clusterServicesCount: 9,
      devices: [
        {
          id: "node-1",
          name: "karpathy",
          hostname: "karpathy",
          os: "linux",
          clientVersion: "1.90.2",
          updateAvailable: false,
          online: true,
          lastSeen: null,
          expiresAt: null,
          daysToExpiry: null,
          tags: ["tag:agent-host"],
          addresses: ["100.64.0.10"],
        },
      ],
    },
    golink: {
      totalLinks: 64,
      countsByTier: { manual: 8, ingress: 22, site: 19, alias: 15 },
      links: [
        {
          slug: "hub",
          targetUrl: "https://hub.tailnet-1a49.ts.net",
          tier: "manual",
          clicks: 142,
          shadows: ["ingress"],
        },
      ],
    },
  };
}

function samplePlatformFacets(): Pick<
  Required<OpsFacetsInput>,
  "cluster" | "observability" | "temporal"
> {
  return {
    cluster: {
      nodes: [
        {
          name: "talos-cp-1",
          ready: true,
          cpuCores: 16,
          cpuRatio: 0.28,
          memoryBytes: 68_719_476_736,
          memoryRatio: 0.61,
          zfsArcBytes: 8_589_934_592,
          tempCelsius: 47,
          kubeletVersion: "v1.34.1",
          talosVersion: "v1.11.2",
          kernelVersion: "6.12.9-talos",
        },
      ],
      workloadSummary: {
        total: 84,
        healthy: 83,
        degraded: 1,
        retainedPools: 2,
      },
      workloads: [
        {
          namespace: "alert-dashboard",
          kind: "Deployment",
          name: "alert-dashboard",
          readyReplicas: 1,
          desiredReplicas: 1,
          restarts24h: 0,
          oomKills24h: 0,
          image: "ghcr.io/shepherdjerred/alert-dashboard@sha256:abc",
          serviceId: "alert-dashboard",
          argoApp: "alert-dashboard",
          retainedPool: false,
        },
      ],
      databases: [
        {
          name: "alert-dashboard-pg",
          namespace: "alert-dashboard",
          engine: "postgres",
          ready: true,
          usedBytes: 536_870_912,
          capacityBytes: 10_737_418_240,
          veleroBackedUp: true,
        },
      ],
      zpools: [
        {
          node: "talos-cp-1",
          pool: "tank",
          usedBytes: 549_755_813_888,
          sizeBytes: 1_099_511_627_776,
          freeBytes: 549_755_813_888,
          fragmentationPercent: 14,
          health: "ONLINE",
        },
      ],
      nvmeDrives: [
        {
          node: "talos-cp-1",
          device: "nvme0n1",
          model: "Samsung 990 PRO 2TB",
          written24hBytes: 21_474_836_480,
          dailyBudgetBytes: 644_245_094_400,
          wearPercent: 3,
          tempCelsius: 41,
        },
      ],
      seaweedfs: {
        volumeCount: 18,
        maxVolumes: 64,
        backupLagSeconds: 120,
        bucketsCount: 7,
      },
      argoApps: [
        {
          name: "alert-dashboard",
          namespace: "argocd",
          syncStatus: "Synced",
          healthStatus: "Healthy",
          revision: "abcdef1234567",
          autoSync: true,
        },
      ],
    },
    observability: {
      prometheus: {
        headSeries: 184_200,
        walPlusBlocksBytes: 12_884_901_888,
        downTargets: [],
        topMetricNames: [
          { name: "apiserver_request_duration_seconds_bucket", series: 9200 },
        ],
      },
      loki: {
        ingestedBytes24h: 2_147_483_648,
        noisyNamespaces: [
          { namespace: "scout-prod", bytes24h: 419_430_400, errorLines1h: 2 },
        ],
        warningEvents: [
          { namespace: "temporal", reason: "BackOff", count1h: 1 },
        ],
        rulerRulesCount: 18,
      },
      tempo: {
        servicesRed: [
          {
            service: "alert-dashboard",
            spanRate: 4.2,
            errorRate: 0,
            p95Ms: 38,
          },
        ],
      },
      grafana: {
        datasourcesCount: 5,
        dashboardsCount: 24,
        dashboards: [
          {
            uid: "scout-for-lol-durable",
            title: "Scout Durable Workflows",
            folder: "Scout",
            url: "https://grafana.tailnet-1a49.ts.net/d/scout-for-lol-durable",
          },
        ],
      },
    },
    temporal: {
      workerPools: [
        {
          deployment: "temporal-ops-worker",
          taskQueue: "ops",
          readyReplicas: 2,
          desiredReplicas: 2,
          pollers: 4,
          slotsAvailable: 96,
        },
      ],
      scheduleSummary: {
        total: 16,
        active: 14,
        paused: 2,
        failing: 0,
      },
      schedules: [
        {
          id: "ops-snapshot-schedule",
          state: "active",
          recentFailures: 0,
          lastRunAt: "2026-11-21T22:00:00Z",
          nextRunAt: "2026-11-21T22:05:00Z",
          taskQueue: "ops",
        },
      ],
    },
  };
}

function sampleFacets(): Required<OpsFacetsInput> {
  return {
    ...sampleDeliveryFacets(),
    ...sampleProductFacets(),
    ...sampleNetworkFacets(),
    ...samplePlatformFacets(),
  };
}

describe("Hub 2.0 OpsFacets schemas", () => {
  it("registers all 13 facet keys and validates each individual facet via FACET_SCHEMAS", () => {
    expect(FACET_KEYS).toEqual([
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
    ]);
    expect(Object.keys(FACET_SCHEMAS)).toEqual([...FACET_KEYS]);

    const facets = sampleFacets();
    for (const key of FACET_KEYS) {
      expect(FacetKeySchema.parse(key)).toBe(key);
      const parsed = FACET_SCHEMAS[key].parse(facets[key]);
      expect(parsed).toBeDefined();
    }

    const full = parseOpsFacets(facets);
    expect(full.renovate?.prConcurrentLimit).toBe(3);
    expect(full.renovate?.items[0]?.consumers).toEqual([]);
  });

  it("applies Renovate defaults and validates enums", () => {
    expect(RenovateUpdateStateSchema.options).toHaveLength(7);
    expect(RenovateImpactLevelSchema.options).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "breaking",
    ]);
    const item = RenovateItemSchema.parse({
      id: "1",
      branch: "renovate/foo",
      title: "Update foo",
      packageName: "foo",
      ecosystem: "npm",
      updateType: "minor",
      state: "pending-checks",
      checked: true,
    });
    expect(item.consumers).toEqual([]);
    expect(
      RenovateVersionDeltaSchema.safeParse({
        cacheKey: "bad",
        generatedAt: "not-an-iso-date",
      }).success,
    ).toBe(false);
  });

  it("keeps SnapshotSchema strict while allowing optional facets on OpsIngestSchema", () => {
    const snapshot = assembleSnapshot({
      generatedAt: new Date("2026-11-21T22:00:00Z"),
      sources: [],
      signals: [],
      metrics: [],
    });
    expect(SnapshotSchema.safeParse({ ...snapshot, facets: {} }).success).toBe(
      false,
    );

    const withoutFacets = OpsIngestSchema.parse({ snapshot, changes: [] });
    expect(withoutFacets.facets).toBeUndefined();

    const withFacets = OpsIngestSchema.parse({
      snapshot,
      changes: [],
      facets: {
        golink: sampleFacets().golink,
        temporal: sampleFacets().temporal,
      },
    });
    expect(withFacets.facets?.golink?.totalLinks).toBe(64);
    expect(withFacets.facets?.temporal?.scheduleSummary.total).toBe(16);

    expect(OpsFacetsSchema.parse({})).toEqual({});
    expect(RenovateFacetSchema).toBe(FACET_SCHEMAS.renovate);
    expect(GitHubFacetSchema).toBe(FACET_SCHEMAS.github);
    expect(PostHogFacetSchema).toBe(FACET_SCHEMAS.posthog);
    expect(BugsinkFacetSchema).toBe(FACET_SCHEMAS.bugsink);
    expect(FliptFacetSchema).toBe(FACET_SCHEMAS.flipt);
    expect(TrackerFacetSchema).toBe(FACET_SCHEMAS.tracker);
    expect(CloudflareFacetSchema).toBe(FACET_SCHEMAS.cloudflare);
    expect(TailscaleFacetSchema).toBe(FACET_SCHEMAS.tailscale);
    expect(GolinkFacetSchema).toBe(FACET_SCHEMAS.golink);
    expect(MonorepoFacetSchema).toBe(FACET_SCHEMAS.monorepo);
    expect(ClusterFacetSchema).toBe(FACET_SCHEMAS.cluster);
    expect(ObservabilityFacetSchema).toBe(FACET_SCHEMAS.observability);
    expect(TemporalFacetSchema).toBe(FACET_SCHEMAS.temporal);
  });
});
