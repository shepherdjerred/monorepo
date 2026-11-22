import type { MonorepoFacet } from "@shepherdjerred/ops-model/facets.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { OpsFacetResponse } from "#shared/ops-schema";
import { InstantTextSchema } from "#shared/time";
import { FIXTURE_OPS_FACETS } from "#test-fixtures/ops-facets";

vi.mock("#client/theme.ts", () => ({
  useResolvedTheme: () => "light",
}));

const { MonorepoPage } = await import("./monorepo-page.tsx");
const { opsKeys } = await import("#client/ops/ops-api.ts");

const GENERATED_AT = InstantTextSchema.parse("2026-11-21T22:30:00Z");
const RECEIVED_AT = InstantTextSchema.parse("2026-11-21T22:30:05Z");

function getFixtureMonorepo(): MonorepoFacet {
  const facet = FIXTURE_OPS_FACETS.monorepo;
  if (facet === undefined) {
    throw new Error("FIXTURE_OPS_FACETS.monorepo is missing");
  }
  return facet;
}

function renderMonorepoPage(url: string, data: MonorepoFacet | null): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const envelope: OpsFacetResponse<"monorepo"> = {
    key: "monorepo",
    generatedAt: GENERATED_AT,
    receivedAt: RECEIVED_AT,
    stale: false,
    data,
  };
  queryClient.setQueryData(opsKeys.facet("monorepo"), envelope);

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <MonorepoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MonorepoPage", () => {
  it("renders a clean empty state when monorepo facet data is null", () => {
    const html = renderMonorepoPage("/monorepo", null);
    expect(html).toContain("<title>Monorepo · Hub</title>");
    expect(html).toContain(
      "No Monorepo workspace telemetry snapshot is stored yet.",
    );
  });

  it("renders workspace KPIs, Turbo cache meter, 4 synchronized charts, audits strip, expensive tasks, and package directory", () => {
    const monorepo = getFixtureMonorepo();
    const html = renderMonorepoPage("/monorepo?range=7d", monorepo);

    expect(html).toContain("<title>Monorepo · Hub</title>");
    expect(html).toContain('aria-label="7d Turbo Cache Hit Ratio"');
    expect(html).toContain("89%");
    expect(html).toContain("41.6 h");
    expect(html).toContain("142");

    // 4 charts
    expect(html).toContain("Turbo cache hit ratio (7d)");
    expect(html).toContain("Turbo cache hit download vs miss upload");
    expect(html).toContain("CI pipeline outcomes");
    expect(html).toContain("Kueue CI CPU usage");

    // Audits strip
    expect(html).toContain("Monorepo audits");
    expect(html).toContain("Architecture boundaries");
    expect(html).toContain("Main dependency vulnerability scan");

    // Expensive tasks sorted by totalMissMinutes descending
    const homelabPos = html.indexOf("@shepherdjerred/homelab#test");
    const scoutPos = html.indexOf("@shepherdjerred/scout-for-lol#build");
    expect(homelabPos).toBeGreaterThan(-1);
    expect(scoutPos).toBeGreaterThan(homelabPos);
    expect(html).toContain("12.6 min");
    expect(html).toContain("81%");

    // Package directory links hosted services to /services/:id and marks Extended tier
    expect(html).toContain('href="/services/alert-dashboard"');
    expect(html).toContain('href="/services/scout-for-lol"');
    expect(html).toContain("Extended");
    expect(html).toContain('aria-label="Package category"');
  });
});
