import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { OpsFacetResponse, OpsFacetsResponse } from "#shared/ops-schema";
import { InstantTextSchema } from "#shared/time";
import { FIXTURE_OPS_FACETS } from "#test-fixtures/ops-facets";

vi.mock("#client/theme.ts", () => ({
  useResolvedTheme: () => "light",
}));

const { FlowEnrichment } = await import("./flow-enrichment.tsx");
const { opsKeys } = await import("./ops-api.ts");
const { renderEngineeringServiceView } =
  await import("./service-views/engineering-views.tsx");

const GENERATED_AT = InstantTextSchema.parse("2026-11-21T22:30:00Z");
const RECEIVED_AT = InstantTextSchema.parse("2026-11-21T22:30:05Z");

function makeClientWithFacets(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const allEnvelope: OpsFacetsResponse = {
    generatedAt: GENERATED_AT,
    receivedAt: RECEIVED_AT,
    stale: false,
    facets: FIXTURE_OPS_FACETS,
  };
  client.setQueryData(opsKeys.facets(), allEnvelope);

  if (FIXTURE_OPS_FACETS.github !== undefined) {
    const env: OpsFacetResponse<"github"> = {
      key: "github",
      generatedAt: GENERATED_AT,
      receivedAt: RECEIVED_AT,
      stale: false,
      data: FIXTURE_OPS_FACETS.github,
    };
    client.setQueryData(opsKeys.facet("github"), env);
  }
  if (FIXTURE_OPS_FACETS.monorepo !== undefined) {
    const env: OpsFacetResponse<"monorepo"> = {
      key: "monorepo",
      generatedAt: GENERATED_AT,
      receivedAt: RECEIVED_AT,
      stale: false,
      data: FIXTURE_OPS_FACETS.monorepo,
    };
    client.setQueryData(opsKeys.facet("monorepo"), env);
  }
  if (FIXTURE_OPS_FACETS.tracker !== undefined) {
    const env: OpsFacetResponse<"tracker"> = {
      key: "tracker",
      generatedAt: GENERATED_AT,
      receivedAt: RECEIVED_AT,
      stale: false,
      data: FIXTURE_OPS_FACETS.tracker,
    };
    client.setQueryData(opsKeys.facet("tracker"), env);
  }
  if (FIXTURE_OPS_FACETS.cluster !== undefined) {
    const env: OpsFacetResponse<"cluster"> = {
      key: "cluster",
      generatedAt: GENERATED_AT,
      receivedAt: RECEIVED_AT,
      stale: false,
      data: FIXTURE_OPS_FACETS.cluster,
    };
    client.setQueryData(opsKeys.facet("cluster"), env);
  }
  return client;
}

describe("FlowEnrichment", () => {
  it("returns empty markup when facets are not yet loaded", () => {
    const emptyClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={emptyClient}>
        <MemoryRouter>
          <FlowEnrichment />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(html).toBe("");
  });

  it("renders non-Renovate git-spice PR stacks, GitHub rate-limit meters, Forum notices, and Tracker throughput", () => {
    const client = makeClientWithFacets();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <FlowEnrichment />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Stacked non-Renovate PRs (#4815 -> #4816 -> #4817), excluding Renovate PR #4812
    expect(html).toContain("git-spice PR stacks");
    expect(html).toContain("#4815");
    expect(html).toContain("#4816");
    expect(html).toContain("#4817");
    expect(html).toContain("└─");
    expect(html).not.toContain("#4812");

    // GitHub GraphQL & Core API rate-limit BudgetMeters + PR code-review summary
    expect(html).toContain("Review pool ready");
    expect(html).toContain("2/2");
    expect(html).toContain("Re-reviews saved 7d");
    expect(html).toContain('href="/monorepo#code-review"');
    expect(html).toContain('aria-label="GitHub GraphQL quota used"');
    expect(html).toContain("4188 remaining");
    expect(html).toContain('aria-label="GitHub Core API quota used"');
    expect(html).toContain("4660 remaining");

    // Active Forum Coordination & Tracker throughput
    expect(html).toContain("FM-42");
    expect(html).toContain("Hub 2.0 multi-wave rollout");
    expect(html).toContain("Completed 7d");
    expect(html).toContain("38");
    expect(html).toContain("AI open");
    expect(html).toContain("24");
  });
});

describe("renderEngineeringServiceView", () => {
  it("renders deep views for ci, delivery variants, tracker, and gitops, and null otherwise", () => {
    const client = makeClientWithFacets();
    const wrap = (id: string) =>
      renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <MemoryRouter>{renderEngineeringServiceView(id, "7d")}</MemoryRouter>
        </QueryClientProvider>,
      );

    const ciHtml = wrap("ci");
    expect(ciHtml).toContain("Woodpecker active CI pods");
    expect(ciHtml).toContain("Kueue CPU usage vs reservation");
    expect(ciHtml).toContain("PR code review gate outcomes");
    expect(ciHtml).toContain("Expensive Turborepo cache misses");

    for (const id of ["delivery", "delivery-control-plane", "delivery-data"]) {
      const deliveryHtml = wrap(id);
      expect(deliveryHtml).toContain("https://delivery.tailnet-1a49.ts.net");
      expect(deliveryHtml).toContain("Active Delivery deployments");
      expect(deliveryHtml).toContain("Delivery deployments by outcome");
    }

    const trackerHtml = wrap("tracker");
    expect(trackerHtml).toContain("Open Tracker issues");
    expect(trackerHtml).toContain("Active Forum notices");
    expect(trackerHtml).toContain("Urgent issues");
    expect(trackerHtml).toContain("SJ-88");

    const gitopsHtml = wrap("gitops");
    expect(gitopsHtml).toContain("Argo CD applications by sync status");
    expect(gitopsHtml).toContain("scout-beta");
    expect(gitopsHtml).toContain("OutOfSync");

    expect(renderEngineeringServiceView("scout-for-lol", "7d")).toBeNull();
  });
});
