import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FacetByKey, FacetKey } from "@shepherdjerred/ops-model/facets.ts";
import type { SnapshotResponse } from "@shepherdjerred/ops-model/snapshot.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { opsKeys } from "#client/ops/ops-api.ts";
import type { OpsFacetResponse } from "#shared/ops-schema";
import { InstantTextSchema } from "#shared/time";
import { FIXTURE_OPS_FACETS } from "#test-fixtures/ops-facets";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";

vi.mock("#client/theme.ts", () => ({
  useResolvedTheme: () => "light",
}));

const { ProductPage, classifyLcpMs, computeStepRetention } =
  await import("./product-page.tsx");
const { renderProductServiceView } =
  await import("#client/ops/service-views/product-views.tsx");

const NOW = "2026-11-21T22:30:00Z";
const INSTANT = InstantTextSchema.parse(NOW);

function buildSnapshotResponse(): SnapshotResponse {
  const ingest = fixtureOpsIngest(NOW);
  return {
    ...ingest.snapshot,
    stale: false,
    ageMs: 15_000,
    receivedAt: NOW,
    newSignalIds: [],
  };
}

function facetEnvelope<K extends FacetKey>(
  key: K,
  data: FacetByKey[K] | null,
): OpsFacetResponse<K> {
  return {
    key,
    generatedAt: INSTANT,
    receivedAt: INSTANT,
    stale: false,
    data,
  };
}

function renderWithQueryClient(
  node: React.JSX.Element,
  seed: (client: QueryClient) => void,
  initialEntry = "/product",
): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  seed(queryClient);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProductPage helpers", () => {
  it("classifies Core Web Vitals p75 LCP into non-color Good / Needs improvement / Poor badges", () => {
    expect(classifyLcpMs(null)).toEqual({
      label: "No data",
      glyph: "—",
      tone: "neutral",
    });
    expect(classifyLcpMs(1890)).toEqual({
      label: "Good",
      glyph: "✓",
      tone: "ok",
    });
    expect(classifyLcpMs(2500)).toEqual({
      label: "Good",
      glyph: "✓",
      tone: "ok",
    });
    expect(classifyLcpMs(3200)).toEqual({
      label: "Needs improvement",
      glyph: "!",
      tone: "warning",
    });
    expect(classifyLcpMs(4500)).toEqual({
      label: "Poor",
      glyph: "✕",
      tone: "error",
    });
  });

  it("computes step-to-step funnel retention percentages safely", () => {
    expect(computeStepRetention(340, null)).toBe(100);
    expect(computeStepRetention(620, 2140)).toBe(29);
    expect(computeStepRetention(50, 0)).toBe(0);
  });
});

describe("ProductPage", () => {
  it("renders KPIs, probe summary, 4 trend charts, funnels, 14-site sparkline table, and top pages/referrers", () => {
    const posthog = FIXTURE_OPS_FACETS.posthog ?? null;
    expect(posthog).not.toBeNull();
    const enrichedPosthog =
      posthog === null
        ? null
        : {
            ...posthog,
            sites: posthog.sites.map((site, index) =>
              index === 0
                ? { ...site, p75LcpMs: 3100 }
                : index === 1
                  ? { ...site, p75LcpMs: 4400 }
                  : site,
            ),
          };

    const html = renderWithQueryClient(<ProductPage />, (client) => {
      client.setQueryData(opsKeys.snapshot(), buildSnapshotResponse());
      client.setQueryData(
        opsKeys.facet("posthog"),
        facetEnvelope("posthog", enrichedPosthog),
      );
    });

    expect(html).toContain("<title>Product · Hub</title>");
    expect(html).toContain("Sites &amp; product");
    expect(html).toContain("Probes down");
    expect(html).toContain("24h pageviews");
    expect(html).toContain("24h active users (DAU)");
    expect(html).toContain("7d weekly active users (WAU)");
    expect(html).toContain("24h client exceptions");

    // Required 4 SeriesChart titles
    expect(html).toContain("Pageviews by site (24h rolling)");
    expect(html).toContain("Daily active users by site");
    expect(html).toContain("Web Vitals p75 LCP");
    expect(html).toContain("Scout matches processed");

    // Conversion funnels with StackedMeter + 24h & 7d counts + retention %
    expect(html).toContain("Scout Discord onboarding");
    expect(html).toContain("The Storm player activation");
    expect(html).toContain("29% of prev");
    expect(html).toContain("75% of prev");
    expect(html).toContain("20% 7d conversion");

    // 14-site DataTable with inline sparklines + tabular counts + CWV non-color badges
    expect(html).toContain("sjer.red");
    expect(html).toContain("scout.sjer.red");
    expect(html).toContain("ts-mc.net");
    expect(html).toContain("glitterboys.org");
    expect(html).toContain("visual-sparkline");
    expect(html).toContain("Needs improvement");
    expect(html).toContain("Poor");
    expect(html).toContain("Good");
    expect(html).toContain("Copy CSV");

    // Top pages & external referrers compact DataTables
    expect(html).toContain("/blog/homelab-talos-zfs");
    expect(html).toContain("news.ycombinator.com");
    expect(html).toContain("discord.com");
  });

  it("renders an informative empty state when the PostHog facet has not been ingested yet", () => {
    const html = renderWithQueryClient(<ProductPage />, (client) => {
      client.setQueryData(opsKeys.snapshot(), buildSnapshotResponse());
      client.setQueryData(
        opsKeys.facet("posthog"),
        facetEnvelope("posthog", null),
      );
    });

    expect(html).toContain("No PostHog analytics facet has been ingested yet.");
    expect(html).toContain("Pageviews by site (24h rolling)");
  });
});

describe("renderProductServiceView (Flags, Bugsink, Golink, Scout)", () => {
  it("renders Flags KPIs, rollout StackedMeter, drift StatusMatrix, and inventory DataTable", () => {
    const flags = FIXTURE_OPS_FACETS.flags;
    expect(flags).toBeDefined();
    const withDrift =
      flags === undefined
        ? null
        : {
            ...flags,
            overdueExceptionsCount: 1,
            namespaces: [
              ...flags.namespaces,
              {
                namespace: "legacy",
                name: "Legacy Ops",
                flagCount: 2,
                prodStatus: "drift" as const,
                betaStatus: "missing" as const,
              },
            ],
            flags: [
              ...flags.flags,
              {
                namespace: "legacy",
                key: "legacy-kill-switch",
                prodEnabled: false,
                betaEnabled: false,
                defaultOffReason: "Kill switch pending cleanup",
                reviewBy: "2020-01-01",
              },
            ],
          };

    const view = renderProductServiceView("flags", "7d");
    expect(view).not.toBeNull();
    const html = renderWithQueryClient(view ?? <div />, (client) => {
      client.setQueryData(
        opsKeys.facet("flags"),
        facetEnvelope("flags", withDrift),
      );
    });

    expect(html).toContain("Total flags");
    expect(html).toContain("Prod enabled");
    expect(html).toContain("Beta enabled");
    expect(html).toContain("Default-off exceptions");
    expect(html).toContain("Overdue exceptions");
    expect(html).toContain("Rollout mix across managed flags");
    expect(html).toContain("Drift");
    expect(html).toContain("Missing");
    expect(html).toContain("scout-experimental-voice-recap");
    expect(html).toContain("Validating Opus TTS budget in scout-beta first");
    expect(html).toContain("! Review by 2026-12-15");
    expect(html).toContain("✕ Overdue (2020-01-01)");
  });

  it("renders Errors command center KPIs, projects summary, and top unresolved issues", () => {
    const view = renderProductServiceView("errors", "7d");
    expect(view).not.toBeNull();
    const html = renderWithQueryClient(view ?? <div />, (client) => {
      client.setQueryData(
        opsKeys.facet("bugsink"),
        facetEnvelope("bugsink", FIXTURE_OPS_FACETS.bugsink ?? null),
      );
    });

    expect(html).toContain("Total unresolved issues");
    expect(html).toContain("Total digested events");
    expect(html).toContain("Scout for LoL");
    expect(html).toContain("RiotUpstreamTimeoutError");
    expect(html).toContain("pollPostmatchHistory");
    expect(html).toContain('aria-label="Open Scout for LoL in Bugsink"');
    expect(html).toContain('aria-label="Open Bugsink issue 1904"');
  });

  it("renders Golink tier StackedMeter, redirect chart, and go/ directory with shadow warnings", () => {
    const view = renderProductServiceView("golink", "7d");
    expect(view).not.toBeNull();
    const html = renderWithQueryClient(view ?? <div />, (client) => {
      client.setQueryData(
        opsKeys.facet("golink"),
        facetEnvelope("golink", FIXTURE_OPS_FACETS.golink ?? null),
      );
    });

    expect(html).toContain("go/ shortlinks by resolution tier");
    for (const tier of ["manual", "ingress", "site", "alias", "shortcut"]) {
      expect(html).toContain(tier);
    }
    expect(html).toContain("go/hub");
    expect(html).toContain("go/graf");
    expect(html).toContain("! Overrides tailscale:grafana");
  });

  it("renders Scout service view combining charts, PostHog prod/beta traffic, and Bugsink issues", () => {
    const view = renderProductServiceView("scout-for-lol", "7d");
    expect(view).not.toBeNull();
    const html = renderWithQueryClient(view ?? <div />, (client) => {
      client.setQueryData(
        opsKeys.facet("posthog"),
        facetEnvelope("posthog", FIXTURE_OPS_FACETS.posthog ?? null),
      );
      client.setQueryData(
        opsKeys.facet("bugsink"),
        facetEnvelope("bugsink", FIXTURE_OPS_FACETS.bugsink ?? null),
      );
    });

    expect(html).toContain("Scout Discord guilds (prod vs beta)");
    expect(html).toContain('data-target="scout-for-lol"');
    expect(html).toContain("scout.sjer.red");
    expect(html).toContain("beta.scout.sjer.red");
    expect(html).toContain("Scout Discord onboarding");
    expect(html).toContain("RiotUpstreamTimeoutError");
  });
});
