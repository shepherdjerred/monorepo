import { describe, expect, it } from "vitest";
import {
  derivePlatformSites,
  deriveSlugForHostname,
  loadPlatformSites,
  type PlatformSiteEntry,
} from "./platform-sites.ts";
import {
  buildCatalog,
  resolveRedirect,
  type ManualLinkRecord,
} from "./resolver.ts";

const TAILNET = "tailnet-1a49.ts.net";
const FIXED_DATE = new Date("2026-11-20T00:00:00.000Z");

function makeManual(
  short: string,
  targetUrl: string,
  overrides?: Partial<ManualLinkRecord>,
): ManualLinkRecord {
  return {
    short,
    targetUrl,
    createdBy: "jerred@tailnet",
    clicks: 3,
    lastClickedAt: FIXED_DATE,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

describe("platform-sites derivation", () => {
  it("maps sjer.red, scout-for-lol.com, ts-mc.net, glitter-boys.com, and standalone domains", () => {
    expect(deriveSlugForHostname("sjer.red")).toBe("sjer");
    expect(deriveSlugForHostname("wiki.sjer.red")).toBe("wiki");
    expect(deriveSlugForHostname("stocks.sjer.red")).toBe("stocks");
    expect(deriveSlugForHostname("scout-for-lol.com")).toBe("scout");
    expect(deriveSlugForHostname("beta.scout-for-lol.com")).toBe("scout-beta");
    expect(deriveSlugForHostname("design.scout-for-lol.com")).toBe(
      "scout-design",
    );
    expect(deriveSlugForHostname("download.scout-for-lol.com")).toBe(
      "scout-download",
    );
    expect(deriveSlugForHostname("ts-mc.net")).toBe("tsmc");
    expect(deriveSlugForHostname("docs.ts-mc.net")).toBe("tsmc-docs");
    expect(deriveSlugForHostname("bluemap.ts-mc.net")).toBe("tsmc-bluemap");
    expect(deriveSlugForHostname("glitter-boys.com")).toBe("glitter-boys");
    expect(deriveSlugForHostname("launcher.glitter-boys.com")).toBe(
      "glitter-boys-launcher",
    );
    expect(deriveSlugForHostname("ppl.glitter-boys.com")).toBe(
      "glitter-boys-ppl",
    );
    expect(deriveSlugForHostname("better-skill-capped.com")).toBe("bsc");
    expect(deriveSlugForHostname("statically-typed.com")).toBe(
      "statically-typed",
    );
    expect(deriveSlugForHostname("clauderon.com")).toBe("clauderon");
  });

  it("never emits reserved slugs or go itself", () => {
    const sites = derivePlatformSites({
      publicHostnames: [
        { hostname: "go.sjer.red", namespace: "golink", service: "golink" },
        { hostname: "api.sjer.red", namespace: "api", service: "api" },
        { hostname: "metrics.sjer.red", namespace: "obs", service: "metrics" },
        {
          hostname: "healthz.sjer.red",
          namespace: "obs",
          service: "healthz",
        },
        { hostname: "readyz.sjer.red", namespace: "obs", service: "readyz" },
        { hostname: "assets.sjer.red", namespace: "cdn", service: "assets" },
      ],
      staticSites: [
        {
          hostname: "public.ts-mc.net",
          bucket: "landing-pages",
          aliases: ["join.ts-mc.net"],
        },
      ],
    });

    expect(sites.map((site) => site.short)).toEqual([
      "tsmc-join",
      "tsmc-public",
    ]);
  });

  it("loads the live homelab platform-model.json cleanly", async () => {
    const sites = await loadPlatformSites();
    const shorts = new Set(sites.map((site) => site.short));
    expect(shorts.has("wiki")).toBe(true);
    expect(shorts.has("scout")).toBe(true);
    expect(shorts.has("scout-beta")).toBe(true);
    expect(shorts.has("tsmc")).toBe(true);
    expect(shorts.has("tsmc-join")).toBe(true);
    expect(shorts.has("bsc")).toBe(true);
    expect(shorts.has("go")).toBe(false);
  });
});

describe("5-tier golink resolver", () => {
  const sampleSites: PlatformSiteEntry[] = [
    {
      short: "argocd",
      targetUrl: "https://argocd.sjer.red/",
      detail: "Public service (argocd/argocd-server)",
    },
    {
      short: "bugsink",
      targetUrl: "https://bugsink.sjer.red/",
      detail: "Public service (bugsink/bugsink-service)",
    },
    {
      short: "wiki",
      targetUrl: "https://wiki.sjer.red/",
      detail: "Static site (wiki.sjer.red)",
    },
    {
      short: "scout",
      targetUrl: "https://scout-for-lol.com/",
      detail: "Static site (scout-for-lol.com)",
    },
  ];

  it("enforces Tier 2 ingress beating Tier 3 site for shared service names", () => {
    const ingressHosts = [
      `argocd.${TAILNET}`,
      "bugsink",
      `go.${TAILNET}`,
      `grafana.${TAILNET}`,
    ];

    const argocdResolved = resolveRedirect({
      short: "argocd",
      manualLinks: [],
      ingressHosts,
      platformSites: sampleSites,
      tailnetDomain: TAILNET,
      dynamicAliasesEnabled: true,
    });
    expect(argocdResolved).toEqual({
      kind: "ingress",
      matchedShort: "argocd",
      location: "https://argocd.tailnet-1a49.ts.net/",
    });

    const bugsinkResolved = resolveRedirect({
      short: "bugsink",
      manualLinks: [],
      ingressHosts,
      platformSites: sampleSites,
      tailnetDomain: TAILNET,
      dynamicAliasesEnabled: true,
    });
    expect(bugsinkResolved).toEqual({
      kind: "ingress",
      matchedShort: "bugsink",
      location: "https://bugsink.tailnet-1a49.ts.net/",
    });

    const goSelf = resolveRedirect({
      short: "go",
      manualLinks: [],
      ingressHosts,
      platformSites: sampleSites,
      tailnetDomain: TAILNET,
      dynamicAliasesEnabled: true,
    });
    expect(goSelf).toBeNull();

    const wikiSite = resolveRedirect({
      short: "wiki",
      manualLinks: [],
      ingressHosts,
      platformSites: sampleSites,
      tailnetDomain: TAILNET,
      dynamicAliasesEnabled: true,
    });
    expect(wikiSite).toEqual({
      kind: "site",
      matchedShort: "wiki",
      location: "https://wiki.sjer.red/",
    });
  });

  it("enforces Tier 1 manual beating all dynamic tiers and attaches shadows metadata", () => {
    const manualLinks = [
      makeManual("grafana", "https://grafana.example.com/dashboards"),
      makeManual("gh", "https://gitlab.example.com/u/jerred"),
    ];
    const catalog = buildCatalog({
      manualLinks,
      ingressHosts: [`grafana.${TAILNET}`],
      platformSites: sampleSites,
      tailnetDomain: TAILNET,
      dynamicAliasesEnabled: true,
    });

    const grafanaItem = catalog.links.find((item) => item.short === "grafana");
    expect(grafanaItem?.kind).toBe("manual");
    expect(grafanaItem?.shadows).toEqual({
      kind: "ingress",
      targetUrl: "https://grafana.tailnet-1a49.ts.net/",
      detail: "Tailscale cluster ingress (grafana.tailnet-1a49.ts.net)",
    });
    expect(
      catalog.links.filter((item) => item.short === "grafana"),
    ).toHaveLength(1);

    const ghItem = catalog.links.find((item) => item.short === "gh");
    expect(ghItem?.shadows).toEqual({
      kind: "shortcut",
      targetUrl: "https://github.com/shepherdjerred/",
      detail: "GitHub profile shortcut",
    });

    const redirect = resolveRedirect({
      short: "grafana",
      manualLinks,
      ingressHosts: [`grafana.${TAILNET}`],
      platformSites: sampleSites,
      tailnetDomain: TAILNET,
      dynamicAliasesEnabled: true,
    });
    expect(redirect).toEqual({
      kind: "manual",
      matchedShort: "grafana",
      location: "https://grafana.example.com/dashboards",
    });
  });

  it("generates Tier 4 suffix-stripped aliases and drops colliding candidates", () => {
    const ingressHosts = [
      "temporal-ui",
      "trmnl-dashboard",
      "storm-forum-admin",
      "gradle-build-cache",
      // Collision pair: both strip to "billing" with different targets
      "billing-ui",
      "billing-service",
      // Direct Tier 2 entry claims "media", so "media-server" cannot overwrite it
      "media",
      "media-server",
    ];

    const catalog = buildCatalog({
      manualLinks: [],
      ingressHosts,
      platformSites: [],
      tailnetDomain: TAILNET,
      dynamicAliasesEnabled: true,
    });

    const byShort = new Map(catalog.links.map((link) => [link.short, link]));
    expect(byShort.get("temporal")).toEqual({
      short: "temporal",
      targetUrl: "https://temporal-ui.tailnet-1a49.ts.net/",
      kind: "alias",
      detail: "Alias for temporal-ui",
    });
    expect(byShort.get("trmnl")?.targetUrl).toBe(
      "https://trmnl-dashboard.tailnet-1a49.ts.net/",
    );
    expect(byShort.get("storm-forum")?.targetUrl).toBe(
      "https://storm-forum-admin.tailnet-1a49.ts.net/",
    );
    expect(byShort.get("gradle")?.targetUrl).toBe(
      "https://gradle-build-cache.tailnet-1a49.ts.net/",
    );
    expect(byShort.has("billing")).toBe(false);
    expect(byShort.get("media")?.kind).toBe("ingress");
    expect(byShort.get("media")?.targetUrl).toBe(
      "https://media.tailnet-1a49.ts.net/",
    );
  });
});

describe("5-tier golink shortcuts, query forwarding, and safety", () => {
  const sampleSites: PlatformSiteEntry[] = [
    {
      short: "wiki",
      targetUrl: "https://wiki.sjer.red/",
      detail: "Static site (wiki.sjer.red)",
    },
  ];

  it("resolves Tier 5 parameterized shortcuts for gh, mono, pr, commit, ai, sj, and fm", () => {
    const baseOpts = {
      manualLinks: [],
      ingressHosts: [],
      platformSites: [],
      tailnetDomain: TAILNET,
      dynamicAliasesEnabled: true,
    };

    expect(resolveRedirect({ ...baseOpts, short: "gh" })?.location).toBe(
      "https://github.com/shepherdjerred/",
    );
    expect(
      resolveRedirect({ ...baseOpts, short: "gh", subpath: "dotfiles/pulls" })
        ?.location,
    ).toBe("https://github.com/shepherdjerred/dotfiles/pulls");
    expect(resolveRedirect({ ...baseOpts, short: "mono" })?.location).toBe(
      "https://github.com/shepherdjerred/monorepo",
    );
    expect(
      resolveRedirect({
        ...baseOpts,
        short: "mono",
        subpath: "tree/main/packages",
      })?.location,
    ).toBe("https://github.com/shepherdjerred/monorepo/tree/main/packages");
    expect(resolveRedirect({ ...baseOpts, short: "pr" })?.location).toBe(
      "https://github.com/shepherdjerred/monorepo/pulls",
    );
    expect(
      resolveRedirect({ ...baseOpts, short: "pr", subpath: "4782" })?.location,
    ).toBe("https://github.com/shepherdjerred/monorepo/pull/4782");
    expect(
      resolveRedirect({ ...baseOpts, short: "pr", subpath: "not-a-number" }),
    ).toBeNull();
    expect(
      resolveRedirect({
        ...baseOpts,
        short: "commit",
        subpath: "A1B2C3D4",
      })?.location,
    ).toBe("https://github.com/shepherdjerred/monorepo/commit/a1b2c3d4");
    expect(
      resolveRedirect({ ...baseOpts, short: "commit", subpath: "short" }),
    ).toBeNull();
    expect(
      resolveRedirect({ ...baseOpts, short: "AI", subpath: "105" })?.location,
    ).toBe("https://tracker.tailnet-1a49.ts.net/issues/AI-105");
    expect(resolveRedirect({ ...baseOpts, short: "AI-105" })?.location).toBe(
      "https://tracker.tailnet-1a49.ts.net/issues/AI-105",
    );
    expect(
      resolveRedirect({ ...baseOpts, short: "sj", subpath: "42" })?.location,
    ).toBe("https://tracker.tailnet-1a49.ts.net/issues/SJ-42");
    expect(resolveRedirect({ ...baseOpts, short: "sj-42" })?.location).toBe(
      "https://tracker.tailnet-1a49.ts.net/issues/SJ-42",
    );
    expect(
      resolveRedirect({ ...baseOpts, short: "fm", subpath: "9" })?.location,
    ).toBe("https://tracker.tailnet-1a49.ts.net/forum/FM-9");
    expect(resolveRedirect({ ...baseOpts, short: "FM-9" })?.location).toBe(
      "https://tracker.tailnet-1a49.ts.net/forum/FM-9",
    );
  });

  it("forwards subpaths and merges query strings without double slashes", () => {
    const manualLinks = [
      makeManual("docs", "https://wiki.sjer.red/reference/?lang=en"),
    ];
    const resolved = resolveRedirect({
      short: "docs",
      subpath: "/golink/setup",
      search: "?theme=dark&tab=api",
      manualLinks,
      ingressHosts: [],
      platformSites: [],
      tailnetDomain: TAILNET,
      dynamicAliasesEnabled: true,
    });

    expect(resolved?.location).toBe(
      "https://wiki.sjer.red/reference/golink/setup?lang=en&theme=dark&tab=api",
    );
  });

  it("serializes internationalized hostnames and non-ASCII paths on direct redirects", () => {
    const manualLinks = [
      makeManual("idn", "https://例え.jp/日本語?q=東京#見出し"),
    ];
    const resolved = resolveRedirect({
      short: "idn",
      manualLinks,
      ingressHosts: [],
      platformSites: [],
      tailnetDomain: TAILNET,
      dynamicAliasesEnabled: true,
    });

    expect(resolved?.location).toBe(
      "https://xn--r8jz45g.jp/%E6%97%A5%E6%9C%AC%E8%AA%9E?q=%E6%9D%B1%E4%BA%AC#%E8%A6%8B%E5%87%BA%E3%81%97",
    );
  });

  it("disables Tiers 2-5 when dynamicAliasesEnabled is false while preserving Tier 1 manual links", () => {
    const manualLinks = [makeManual("docs", "https://wiki.sjer.red/")];
    const catalog = buildCatalog({
      manualLinks,
      ingressHosts: [`grafana.${TAILNET}`],
      platformSites: sampleSites,
      tailnetDomain: TAILNET,
      dynamicAliasesEnabled: false,
    });

    expect(catalog.links.map((item) => item.short)).toEqual(["docs"]);
    expect(catalog.shortcuts).toEqual([]);

    expect(
      resolveRedirect({
        short: "docs",
        manualLinks,
        ingressHosts: [`grafana.${TAILNET}`],
        platformSites: sampleSites,
        tailnetDomain: TAILNET,
        dynamicAliasesEnabled: false,
      })?.location,
    ).toBe("https://wiki.sjer.red/");

    expect(
      resolveRedirect({
        short: "grafana",
        manualLinks,
        ingressHosts: [`grafana.${TAILNET}`],
        platformSites: sampleSites,
        tailnetDomain: TAILNET,
        dynamicAliasesEnabled: false,
      }),
    ).toBeNull();

    expect(
      resolveRedirect({
        short: "pr",
        subpath: "4782",
        manualLinks,
        ingressHosts: [],
        platformSites: [],
        tailnetDomain: TAILNET,
        dynamicAliasesEnabled: false,
      }),
    ).toBeNull();
  });

  it("rejects unsafe javascript: and data: schemes even if present in stored records", () => {
    const unsafeLinks = [
      makeManual("xss-js", "javascript:alert(1)"),
      makeManual("xss-data", "data:text/html,<script>alert(1)</script>"),
    ];

    const catalog = buildCatalog({
      manualLinks: unsafeLinks,
      ingressHosts: [],
      platformSites: [],
      tailnetDomain: TAILNET,
      dynamicAliasesEnabled: true,
    });
    expect(catalog.links).toEqual([]);

    expect(
      resolveRedirect({
        short: "xss-js",
        manualLinks: unsafeLinks,
        ingressHosts: [],
        platformSites: [],
        tailnetDomain: TAILNET,
        dynamicAliasesEnabled: true,
      }),
    ).toBeNull();

    expect(
      resolveRedirect({
        short: "xss-data",
        manualLinks: unsafeLinks,
        ingressHosts: [],
        platformSites: [],
        tailnetDomain: TAILNET,
        dynamicAliasesEnabled: true,
      }),
    ).toBeNull();
  });
});
