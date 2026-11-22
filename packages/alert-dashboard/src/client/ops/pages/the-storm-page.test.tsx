import { Temporal } from "@js-temporal/polyfill";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SnapshotResponse } from "@shepherdjerred/ops-model/snapshot.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { opsKeys } from "#client/ops/ops-api.ts";
import type { ChangeView, OpsFacetResponse } from "#shared/ops-schema";
import { InstantTextSchema } from "#shared/time";
import { FIXTURE_OPS_FACETS } from "#test-fixtures/ops-facets";
import {
  buildFixtureIngest,
  fixtureOpsIngest,
} from "#test-fixtures/ops-snapshot";

vi.mock("#client/theme.ts", () => ({
  useResolvedTheme: () => "light",
}));

const { renderProductServiceView } =
  await import("#client/ops/service-views/product-views.tsx");
const { STORM_SERVICE_IDS, TheStormPage, selectStormAnalytics } =
  await import("./the-storm-page.tsx");

const NOW = "2026-11-21T22:30:00Z";
const INSTANT = InstantTextSchema.parse(NOW);

function buildStormSnapshot(): SnapshotResponse {
  const base = fixtureOpsIngest(NOW);
  const now = Temporal.Instant.from(NOW);
  const withStormSignal = buildFixtureIngest({
    now,
    signals: [
      ...base.snapshot.sections.flatMap((section) => section.signals),
      {
        id: "minecraft:tsmc-lag",
        source: "probes",
        section: "product",
        service: "minecraft",
        kind: "probe",
        severity: "warning",
        needsMe: false,
        title: "minecraft-tsmc tick duration elevated",
        detail: "MSPT 44ms during survival event",
      },
      {
        id: "storm-brain:queue",
        source: "kubernetes",
        section: "platform",
        service: "storm-brain",
        kind: "workload",
        severity: "info",
        needsMe: false,
        title: "storm-brain companion updated",
      },
    ],
    metrics: base.snapshot.sections.flatMap((section) =>
      section.metrics.map((m) => ({ ...m, section: section.id })),
    ),
    changes: base.changes,
  });
  return {
    ...withStormSignal.snapshot,
    stale: false,
    ageMs: 10_000,
    receivedAt: NOW,
    newSignalIds: ["minecraft:tsmc-lag"],
  };
}

describe("TheStormPage", () => {
  it("extracts ts-mc.net traffic and player activation funnel from PostHog facet", () => {
    const summary = selectStormAnalytics(FIXTURE_OPS_FACETS.posthog ?? null);
    expect(summary).not.toBeNull();
    expect(summary?.pageviews24h).toBe(960);
    expect(summary?.dau24h).toBe(294);
    expect(summary?.wau7d).toBe(1520);
    expect(summary?.funnels[0]?.id).toBe("storm-join");
    expect(selectStormAnalytics(null)).toBeNull();
  });

  it("renders heading, quick links, service cards, ts-mc.net analytics, 4 synced charts, signals, and changes", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const posthogEnvelope: OpsFacetResponse<"posthog"> = {
      key: "posthog",
      generatedAt: INSTANT,
      receivedAt: INSTANT,
      stale: false,
      data: FIXTURE_OPS_FACETS.posthog ?? null,
    };
    const stormChanges: readonly ChangeView[] = [
      {
        id: "chg-mc-1",
        source: "argocd",
        externalId: "minecraft-tsmc:88",
        kind: "deploy",
        service: "minecraft",
        title: "minecraft-tsmc promoted survival build 1.21.4",
        occurredAt: "2026-11-21T21:00:00Z",
        severity: "info",
      },
    ];
    queryClient.setQueryData(opsKeys.snapshot(), buildStormSnapshot());
    queryClient.setQueryData(opsKeys.facet("posthog"), posthogEnvelope);
    queryClient.setQueryData(
      [...opsKeys.all, "changes", "storm"],
      stormChanges,
    );

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/the-storm"]}>
          <TheStormPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain("<title>The Storm · Hub</title>");
    expect(html).toContain("Minecraft &amp; community");
    expect(html).toContain("<h1>The Storm</h1>");

    // Required quick links
    expect(html).toContain('href="/promotion"');
    expect(html).toContain('href="/services/minecraft"');
    expect(html).toContain('href="/services/storm-brain"');
    expect(html).toContain('href="/services/storm-forum"');
    expect(html).toContain('href="https://ts-mc.net"');

    // Synthesized ts-mc.net analytics & funnel
    expect(html).toContain("ts-mc.net community traffic");
    expect(html).toContain("The Storm player activation:");
    expect(html).toContain("visual-sparkline");

    // Required 4 SeriesChart panels
    expect(html).toContain("Online players by edition");
    expect(html).toContain("Storm Brain companion requests");
    expect(html).toContain("Minecraft namespace CPU");
    expect(html).toContain("Minecraft namespace memory");
    expect(html).toContain('data-target="minecraft"');

    // Signals & recent changes across Storm services
    expect(STORM_SERVICE_IDS).toEqual([
      "minecraft",
      "storm-brain",
      "storm-forum",
    ]);
    expect(html).toContain("minecraft-tsmc tick duration elevated");
    expect(html).toContain("storm-brain companion updated");
    expect(html).toContain("minecraft-tsmc promoted survival build 1.21.4");
  });

  it("renders targeted service views for streambot, mail, minecraft, storm-brain, storm-forum, and null for unknown ids", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    for (const [id, expectedTarget] of [
      ["streambot", "media"],
      ["mail", "postal"],
      ["minecraft", "minecraft"],
      ["storm-brain", "storm-brain"],
      ["storm-forum", "storm-forum"],
    ] as const) {
      const view = renderProductServiceView(id, "24h");
      expect(view).not.toBeNull();
      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>{view}</MemoryRouter>
        </QueryClientProvider>,
      );
      expect(html).toContain(`data-target="${expectedTarget}"`);
    }

    expect(renderProductServiceView("delivery", "7d")).toBeNull();
    expect(renderProductServiceView("unknown-service", "7d")).toBeNull();
  });
});
