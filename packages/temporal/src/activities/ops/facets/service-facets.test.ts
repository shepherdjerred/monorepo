import { describe, expect, test } from "vitest";
import { CloudflareClient } from "@shepherdjerred/ops-clients/cloudflare.ts";
import { GolinkClient } from "@shepherdjerred/ops-clients/golink.ts";
import { TailscaleClient } from "@shepherdjerred/ops-clients/tailscale.ts";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import {
  BugsinkFacetSchema,
  CloudflareFacetSchema,
  FliptFacetSchema,
  GitHubFacetSchema,
  GolinkFacetSchema,
  PostHogFacetSchema,
  TailscaleFacetSchema,
  TrackerFacetSchema,
} from "@shepherdjerred/ops-model/facets.ts";
import { register } from "#observability/metrics.ts";
import {
  buildBugsinkFacet,
  recordBugsinkFacetGauges,
} from "./bugsink-facet.ts";
import {
  cachedRdapExpiryDays,
  clearRdapCacheForTests,
  collectCloudflareFacet,
} from "./cloudflare-facet.ts";
import { collectFliptFacet } from "./flipt-facet.ts";
import { buildGitHubFacet } from "./github-facet.ts";
import { collectGolinkFacet } from "./golink-facet.ts";
import {
  buildPostHogFacet,
  recordPostHogFacetGauges,
} from "./posthog-facet.ts";
import { collectTailscaleFacet } from "./tailscale-facet.ts";
import { buildTrackerFacet } from "./tracker-facet.ts";

const now = new Date("2026-11-21T22:00:00.000Z");
const services = new ServiceIndex();

describe("github and posthog facets", () => {
  test("github facet populates openPrs, merged7d, mergesByAuthor7d, and rateLimits", () => {
    const facet = buildGitHubFacet({
      open: [
        {
          number: 901,
          title: "feat(birmel): improve voice queue",
          url: "https://github.com/shepherdjerred/monorepo/pull/901",
          author: { login: "derrej", kind: "user" },
          draft: false,
          createdAt: "2026-11-21T16:00:00Z",
          updatedAt: "2026-11-21T20:00:00Z",
          reviewDecision: "APPROVED",
          mergeable: "MERGEABLE",
          branch: "feat/voice-queue",
          baseRefName: "main",
          headOid: "sha1",
          exactHeadApproved: true,
          labels: ["ready"],
          checks: "SUCCESS",
        },
      ],
      merged30d: [
        {
          number: 900,
          title: "fix(tracker): speed up forum query",
          url: "https://github.com/shepherdjerred/monorepo/pull/900",
          branch: "fix/forum",
          author: { login: "shepherdjerred", kind: "user" },
          createdAt: "2026-11-20T08:00:00Z",
          mergedAt: "2026-11-20T10:00:00Z",
        },
      ],
      rateLimits: {
        graphql: {
          used: 120,
          limit: 5000,
          remaining: 4880,
          resetAt: "2026-11-21T23:00:00Z",
        },
        core: null,
      },
      now,
    });

    expect(() => GitHubFacetSchema.parse(facet)).not.toThrow();
    expect(facet.openPrs[0]).toMatchObject({
      number: 901,
      authorKind: "agent",
      ageHours: 6,
      baseRefName: "main",
      exactHeadApproved: true,
      isRenovate: false,
    });
    expect(facet.mergesByAuthor7d).toEqual({ shepherdjerred: 1 });
  });

  test("posthog facet joins traffic, vitals, referrers, funnels, 14+ sites, and gauges", async () => {
    const facet = buildPostHogFacet({
      traffic: [
        {
          siteKey: "sjer-red",
          host: "sjer.red",
          pageviews24h: 450,
          dau24h: 110,
          wau7d: 620,
          dailySeries7d: [50, 60, 55, 70, 80, 65, 70],
          exceptions24h: 1,
          rageclicks24h: 2,
        },
      ],
      topPages: [{ host: "sjer.red", path: "/", pageviews: 210 }],
      webVitals: [{ host: "sjer.red", lcpP75: 920, inpP75: 44, samples: 80 }],
      topReferrers: [{ domain: "github.com", count: 35 }],
      funnelCounts: [
        { event: "guild_installed", count24h: 4, count7d: 19 },
        { event: "storm_session_started", count24h: 12, count7d: 58 },
        { event: "streambot_play_requested", count24h: 30, count7d: 180 },
      ],
      services,
    });

    expect(() => PostHogFacetSchema.parse(facet)).not.toThrow();
    expect(facet.sites.length).toBeGreaterThanOrEqual(14);
    const sjer = facet.sites.find((s) => s.host === "sjer.red");
    expect(sjer).toMatchObject({
      pageviews24h: 450,
      dau24h: 110,
      p75LcpMs: 920,
      p75InpMs: 44,
    });
    expect(facet.funnels.map((f) => f.id)).toEqual([
      "scout",
      "storm",
      "streambot",
    ]);

    recordPostHogFacetGauges(facet);
    const metrics = await register.metrics();
    expect(metrics).toContain(
      'posthog_site_pageviews_24h{site="sjer-red",host="sjer.red",component="temporal-worker"} 450',
    );
    expect(metrics).toContain(
      'posthog_site_dau_24h{site="sjer-red",host="sjer.red",component="temporal-worker"} 110',
    );
    expect(metrics).toContain(
      'posthog_site_lcp_p75_ms{site="sjer-red",host="sjer.red",component="temporal-worker"} 920',
    );
  });
});

describe("bugsink, tracker, and flipt facets", () => {
  test("bugsink facet summarizes active, stale, muted, digested events, and sets gauge", async () => {
    const facet = buildBugsinkFacet({
      projectsWithIssues: [
        {
          project: {
            id: 2,
            slug: "birmel",
            name: "Birmel",
            digested_event_count: 85,
          },
          issues: [
            {
              id: "iss-1",
              projectId: 2,
              firstSeen: "2026-11-20T00:00:00Z",
              lastSeen: "2026-11-21T20:00:00Z",
              events: 40,
              type: "Error",
              value: "Voice timeout",
              transaction: "connectVoice",
              muted: false,
            },
            {
              id: "iss-2",
              projectId: 2,
              firstSeen: "2026-10-01T00:00:00Z",
              lastSeen: "2026-10-10T00:00:00Z",
              events: 5,
              type: "Warn",
              value: "Old stale",
              transaction: "init",
              muted: false,
            },
            {
              id: "iss-3",
              projectId: 2,
              firstSeen: "2026-11-20T00:00:00Z",
              lastSeen: "2026-11-21T00:00:00Z",
              events: 10,
              type: "Noise",
              value: "Muted",
              transaction: "noop",
              muted: true,
            },
          ],
        },
      ],
      now,
    });

    expect(() => BugsinkFacetSchema.parse(facet)).not.toThrow();
    expect(facet.totalUnresolved).toBe(2);
    expect(facet.totalDigestedEvents).toBe(85);
    expect(facet.projects[0]).toMatchObject({
      slug: "birmel",
      activeIssues7d: 1,
      staleIssues: 1,
      mutedIssues: 1,
      digestedEventsTotal: 85,
      topIssueTitle: "Error: Voice timeout",
    });

    recordBugsinkFacetGauges(facet);
    const metrics = await register.metrics();
    expect(metrics).toContain(
      'bugsink_project_digested_events{project="birmel",component="temporal-worker"} 85',
    );
  });

  test("tracker facet aggregates teams, notices, projects, and urgent issues", () => {
    const facet = buildTrackerFacet({
      overview: {
        open: [
          {
            id: "1",
            identifier: "SJ-10",
            title: "Review storage budget",
            url: "https://tracker.tailnet-1a49.ts.net/issues/SJ-10",
            createdAt: "2026-11-21T00:00:00Z",
            projectSlug: "infra",
            team: "SJ",
            stateType: "triage",
          },
          {
            id: "2",
            identifier: "AI-20",
            title: "Automate cache check",
            url: "https://tracker.tailnet-1a49.ts.net/issues/AI-20",
            createdAt: "2026-11-20T00:00:00Z",
            projectSlug: "devex",
            team: "AI",
            stateType: "started",
          },
        ],
        counts: { SJ: { triage: 1 }, AI: { started: 1 } },
        triage: [
          {
            id: "1",
            identifier: "SJ-10",
            title: "Review storage budget",
            url: "https://tracker.tailnet-1a49.ts.net/issues/SJ-10",
            createdAt: "2026-11-21T00:00:00Z",
            team: "SJ",
            stateType: "triage",
          },
        ],
      },
      notices: [
        {
          id: "n1",
          identifier: "FM-5",
          kind: "notice",
          title: "Deploying Hub 2.0",
          url: "https://tracker.tailnet-1a49.ts.net/forum/FM-5",
          scopes: ["ops"],
          creatorKey: "derrej",
          ownerKey: "derrej",
          exitCondition: null,
          expiresAt: null,
          replyCount: 0,
          answered: false,
          createdAt: "2026-11-21T20:00:00Z",
          lastActivityAt: "2026-11-21T21:00:00Z",
        },
      ],
      projects: [
        {
          id: "p1",
          slug: "devex",
          name: "Developer Experience",
          url: "https://tracker.tailnet-1a49.ts.net/projects/devex",
          open: 4,
          completed: 30,
          completed7d: 6,
        },
      ],
      throughput: {
        total: 14,
        byTeam: { AI: 12, SJ: 2 },
        byProject: { devex: 6 },
        issues: [],
      },
    });

    expect(() => TrackerFacetSchema.parse(facet)).not.toThrow();
    expect(facet.openByTeam).toEqual({ SJ: 1, AI: 1 });
    expect(facet.triageCount).toBe(1);
    expect(facet.completed7dCount).toBe(14);
    expect(facet.activeNotices[0]?.identifier).toBe("FM-5");
    expect(facet.projects[0]).toMatchObject({ slug: "devex", team: "AI" });
    expect(facet.urgentIssues[0]?.identifier).toBe("SJ-10");
  });

  test("flipt facet emits unknown on static/500, detects live drift, and surfaces malformed snapshots", async () => {
    const staticFacet = await collectFliptFacet({ fliptUrl: "", now });
    expect(() => FliptFacetSchema.parse(staticFacet)).not.toThrow();
    expect(staticFacet.namespaces).toHaveLength(16);
    expect(staticFacet.totalFlags).toBeGreaterThan(0);
    expect(
      staticFacet.namespaces.every((ns) => ns.prodStatus === "unknown"),
    ).toBe(true);

    const unavailableFacet = await collectFliptFacet({
      fliptUrl: "http://flipt:8080",
      now,
      fetcher: () =>
        Promise.resolve(new Response("upstream error", { status: 500 })),
    });
    expect(
      unavailableFacet.namespaces.every((ns) => ns.prodStatus === "unknown"),
    ).toBe(true);

    const driftedFacet = await collectFliptFacet({
      fliptUrl: "http://flipt:8080",
      now,
      fetcher: () => Promise.resolve(Response.json({ flags: [] })),
    });
    expect(() => FliptFacetSchema.parse(driftedFacet)).not.toThrow();
    expect(
      driftedFacet.namespaces.every((ns) => ns.prodStatus === "missing"),
    ).toBe(true);

    await expect(
      collectFliptFacet({
        fliptUrl: "http://flipt:8080",
        now,
        fetcher: () =>
          Promise.resolve(Response.json({ flags: [{ key: 123 }] })),
      }),
    ).rejects.toThrow();
  });
});

function createFakeCloudflareFetch(onRdap: () => void) {
  return (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith("https://rdap.org/domain/")) {
      onRdap();
      return Promise.resolve(
        Response.json({
          events: [
            { eventAction: "expiration", eventDate: "2027-09-21T00:00:00Z" },
          ],
        }),
      );
    }
    if (url.includes("/zones?")) {
      return Promise.resolve(
        Response.json({
          success: true,
          result: [
            { id: "z1", name: "sjer.red", status: "active", paused: false },
          ],
        }),
      );
    }
    if (url.includes("/dnssec")) {
      return Promise.resolve(
        Response.json({ success: true, result: { status: "active" } }),
      );
    }
    if (url.endsWith("/dns_records?per_page=1")) {
      return Promise.resolve(
        Response.json({
          success: true,
          result: [],
          result_info: { total_count: 25 },
        }),
      );
    }
    if (url.includes("/dns_records")) {
      return Promise.resolve(
        Response.json({
          success: true,
          result: [
            { id: "1", type: "TXT", name: "sjer.red", content: "v=spf1 -all" },
            {
              id: "2",
              type: "TXT",
              name: "_dmarc.sjer.red",
              content: "v=DMARC1; p=reject;",
            },
            { id: "3", type: "MX", name: "sjer.red", content: "mx.sjer.red" },
            {
              id: "4",
              type: "TXT",
              name: "_mta-sts.sjer.red",
              content: "v=STSv1; id=1",
            },
          ],
        }),
      );
    }
    if (url.includes("/r2/buckets")) {
      return Promise.resolve(
        Response.json({
          success: true,
          result: { buckets: [{ name: "backups" }] },
        }),
      );
    }
    return Promise.resolve(
      Response.json(
        url.endsWith("/graphql")
          ? {
              data: {
                viewer: {
                  accounts: [
                    {
                      r2StorageAdaptiveGroups: [
                        {
                          dimensions: { bucketName: "backups" },
                          max: {
                            payloadSize: 4096,
                            metadataSize: 0,
                            objectCount: 3,
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            }
          : { success: true, result: [] },
      ),
    );
  };
}

describe("cloudflare, tailscale, and golink facets", () => {
  test("cloudflare facet caches RDAP for 1h, evaluates 7-check matrix, and sets R2 gauge", async () => {
    clearRdapCacheForTests();
    let rdapCalls = 0;
    const fakeFetch = createFakeCloudflareFetch(() => {
      rdapCalls += 1;
    });

    const firstDays = await cachedRdapExpiryDays({
      domain: "sjer.red",
      fetchImpl: fakeFetch,
      now,
    });
    const secondDays = await cachedRdapExpiryDays({
      domain: "sjer.red",
      fetchImpl: fakeFetch,
      now: new Date(now.getTime() + 5 * 60_000),
    });
    expect(firstDays).toBe(secondDays);
    expect(rdapCalls).toBe(1);

    const client = new CloudflareClient({
      apiToken: "cf-test",
      accountId: "acc-1",
      fetch: fakeFetch,
    });
    const facet = await collectCloudflareFacet({
      apiToken: "cf-test",
      accountId: "acc-1",
      client,
      fetchImpl: fakeFetch,
      now,
    });
    expect(facet).toBeDefined();
    expect(() => CloudflareFacetSchema.parse(facet)).not.toThrow();
    expect(facet?.domains[0]).toMatchObject({
      domain: "sjer.red",
      dnssec: "ok",
      spf: "ok",
      dmarc: "ok",
      mx: "ok",
      mtaSts: "ok",
      tls: "ok",
      recordCount: 25,
    });
    const metrics = await register.metrics();
    expect(metrics).toContain(
      'cloudflare_r2_storage_bytes{bucket="backups",component="temporal-worker"} 4096',
    );
  });

  test("tailscale facet handles unconfigured gracefully and sets online gauge when configured", async () => {
    const unconfigured = await collectTailscaleFacet({
      services,
      apiKey: "",
      oauthClientId: "",
      oauthClientSecret: "",
    });
    expect(() => TailscaleFacetSchema.parse(unconfigured)).not.toThrow();
    expect(unconfigured.devices).toEqual([]);
    expect(unconfigured.clusterServicesCount).toBeGreaterThan(0);

    const client = new TailscaleClient({
      apiKey: "tskey-test",
      fetch: () =>
        Promise.resolve(
          Response.json({
            devices: [
              {
                id: "d1",
                name: "torvalds.tailnet",
                hostname: "torvalds",
                os: "linux",
                clientVersion: "1.90.0",
                connectedToControl: true,
                expires: "2026-11-28T00:00:00Z",
              },
            ],
          }),
        ),
    });
    const configured = await collectTailscaleFacet({
      services,
      client,
      now,
    });
    expect(() => TailscaleFacetSchema.parse(configured)).not.toThrow();
    expect(configured.onlineDevices).toBe(1);
    expect(configured.expiringKeysSoon).toBe(1);
    const metrics = await register.metrics();
    expect(metrics).toContain(
      'tailscale_devices_online{component="temporal-worker"} 1',
    );
  });

  test("golink facet aggregates links and shadows by tier", async () => {
    const client = new GolinkClient({
      baseUrl: "http://golink:7352",
      fetch: () =>
        Promise.resolve(
          Response.json({
            links: [
              {
                short: "hub",
                targetUrl: "https://hub.tailnet-1a49.ts.net",
                kind: "manual",
                clicks: 12,
                shadows: {
                  kind: "ingress",
                  targetUrl: "https://alert-dashboard.tailnet-1a49.ts.net",
                },
              },
            ],
          }),
        ),
    });
    const facet = await collectGolinkFacet({ client });
    expect(facet).toBeDefined();
    expect(() => GolinkFacetSchema.parse(facet)).not.toThrow();
    expect(facet?.countsByTier).toEqual({ manual: 1 });
    expect(facet?.links[0]?.shadows).toEqual(["ingress"]);
  });
});
