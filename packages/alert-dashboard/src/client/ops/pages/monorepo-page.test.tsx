import type { MonorepoFacet } from "@shepherdjerred/ops-model/facets.ts";
import { describe, expect, it, vi } from "vitest";

vi.mock("#client/theme.ts", () => ({
  useResolvedTheme: () => "light",
}));

const { MonorepoPage } = await import("./monorepo-page.tsx");
const { renderSeededFacetRoute, requireFixtureFacet } =
  await import("./facet-page-test-helpers.tsx");

function renderMonorepoPage(url: string, data: MonorepoFacet | null): string {
  return renderSeededFacetRoute({
    key: "monorepo",
    url,
    data,
    children: <MonorepoPage />,
  });
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
    const monorepo = requireFixtureFacet("monorepo");
    const html = renderMonorepoPage("/monorepo?range=7d", monorepo);

    expect(html).toContain("<title>Monorepo · Hub</title>");
    expect(html).toContain('aria-label="7d Turbo cache hit ratio"');
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
    // Task ids may wrap only after "/" or "#": no-wrap segments with a
    // <wbr> between them.
    const homelabPos = html.indexOf(
      '<span class="id-seg">@shepherdjerred/</span><wbr/><span class="id-seg">homelab#</span><wbr/><span class="id-seg">test</span>',
    );
    const scoutPos = html.indexOf(
      '<span class="id-seg">@shepherdjerred/</span><wbr/><span class="id-seg">scout-for-lol#</span><wbr/><span class="id-seg">build</span>',
    );
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
