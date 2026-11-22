import type { RenovateFacet } from "@shepherdjerred/ops-model/facets.ts";
import { describe, expect, it, vi } from "vitest";

vi.mock("#client/theme.ts", () => ({
  useResolvedTheme: () => "light",
}));

const { renderSeededFacetRoute, requireFixtureFacet } =
  await import("./facet-page-test-helpers.tsx");
const { filterRenovateItemsByTab, parseRenovateTab, RenovatePage } =
  await import("./renovate-page.tsx");

function getFixtureRenovate(): RenovateFacet {
  return requireFixtureFacet("renovate");
}

function renderRenovatePage(
  url: string,
  data: RenovateFacet | null,
  stale = false,
): string {
  return renderSeededFacetRoute({
    key: "renovate",
    url,
    data,
    stale,
    children: <RenovatePage />,
  });
}

describe("RenovatePage helpers", () => {
  it("parses valid URL tabs and falls back to prs", () => {
    expect(parseRenovateTab("approval")).toBe("approval");
    expect(parseRenovateTab("held")).toBe("held");
    expect(parseRenovateTab("hygiene")).toBe("hygiene");
    expect(parseRenovateTab("merged")).toBe("merged");
    expect(parseRenovateTab("unknown-tab")).toBe("prs");
    expect(parseRenovateTab(null)).toBe("prs");
  });

  it("partitions Renovate items into tab buckets accurately", () => {
    const renovate = getFixtureRenovate();
    expect(
      filterRenovateItemsByTab(renovate.items, "prs").map((i) => i.packageName),
    ).toEqual(["hono", "loki"]);
    expect(
      filterRenovateItemsByTab(renovate.items, "approval").map(
        (i) => i.packageName,
      ),
    ).toEqual(["prisma"]);
    expect(
      filterRenovateItemsByTab(renovate.items, "held").map(
        (i) => i.packageName,
      ),
    ).toEqual(["hono"]);
    expect(
      filterRenovateItemsByTab(renovate.items, "hygiene").map(
        (i) => i.packageName,
      ),
    ).toEqual(["loki"]);
  });
});

describe("RenovatePage rendering, tabs, and LLM version-delta drawer", () => {
  it("renders graceful empty state when facet data is null", () => {
    const html = renderRenovatePage("/renovate", null);
    expect(html).toContain("<title>Renovate · Hub</title>");
    expect(html).toContain(
      "No Renovate dependency dashboard snapshot is stored yet.",
    );
  });

  it("renders KPIs, meters, charts, conditional banners, and Open PRs tab with version mismatch highlight", () => {
    const fixture = getFixtureRenovate();
    const enriched: RenovateFacet = {
      ...fixture,
      issueNumber: 481,
      truncated: true,
      lookupWarnings: [
        "Failed to look up docker tag docker.io/library/postgres",
      ],
    };

    const html = renderRenovatePage("/renovate?tab=prs&range=30d", enriched);
    expect(html).toContain("<title>Renovate · Hub</title>");

    // Conditional lookup warning & truncation banners
    expect(html).toContain("1 Renovate package lookup warning");
    expect(html).toContain(
      "Failed to look up docker tag docker.io/library/postgres",
    );
    expect(html).toContain(
      "Dependency Dashboard issue body is truncated upstream.",
    );
    expect(html).toContain("Open Issue #481");

    // Meters & KPIs
    expect(html).toContain('aria-label="Open Renovate PRs"');
    expect(html).toContain('aria-label="LLM Delta Coverage"');
    expect(html).toContain("1 breaking delta across 3 tracked updates");
    expect(html).toContain("29 / 114");
    expect(html).toContain("Median 2.4h to merge");

    // 4 rich visual panels (3 SeriesCharts + Ecosystem & Update-type StackedMeters)
    expect(html).toContain("Backlog by state");
    expect(html).toContain("Renovate merges (7d)");
    expect(html).toContain("Oldest open PR age");
    expect(html).toContain("Ecosystem breakdown");
    expect(html).toContain("Update-type mix");

    // Accessible tablist + Open PRs tab selected
    expect(html).toContain('role="tablist"');
    expect(html).toContain(
      'id="renovate-tab-prs" role="tab" type="button" class="eng-tab" aria-selected="true"',
    );
    expect(html).toContain('role="tabpanel" id="renovate-panel-prs"');

    // Loki row shows running !== pinned mismatch highlight & half-upgrade pill
    expect(html).toContain("Running v6.21.0 → v6.24.0");
    expect(html).toContain("Pinned v6.22.0 ≠ Running v6.21.0");
    expect(html).toContain("Half-upgrade");
  });

  it("switches across Pending Approval, Hygiene & Deprecations, and Recent Merges tabs and expands LLM Version Delta drawer", () => {
    const renovate = getFixtureRenovate();

    // Pending Approval tab with expanded prisma breaking delta drawer
    const approvalHtml = renderRenovatePage(
      "/renovate?tab=approval&expand=renovate:prisma-8",
      renovate,
    );
    expect(approvalHtml).toContain(
      'id="renovate-tab-approval" role="tab" type="button" class="eng-tab" aria-selected="true"',
    );
    expect(approvalHtml).toContain("Breaking");
    expect(approvalHtml).toContain(
      "Drops legacy Rust query engine fallback in favor of driver adapters",
    );
    expect(approvalHtml).toContain(
      "PrismaClient constructor requires an explicit driver adapter in all runtimes",
    );
    expect(approvalHtml).toContain(
      "alert-dashboard and delivery already pass driver adapters",
    );
    expect(approvalHtml).toContain("github-releases");
    expect(approvalHtml).toContain("Compare diff");
    expect(approvalHtml).toContain("Release notes 1");
    expect(approvalHtml).toContain(
      "git fetch origin renovate/prisma-8.x &amp;&amp; git switch -c fix/renovate-prisma-8.x origin/renovate/prisma-8.x",
    );
    expect(approvalHtml).toContain('aria-label="Copy command for prisma"');

    // Hygiene & Deprecations tab includes deprecations table
    const hygieneHtml = renderRenovatePage("/renovate?tab=hygiene", renovate);
    expect(hygieneHtml).toContain("Deprecated dependencies");
    expect(hygieneHtml).toContain("@opentelemetry/sdk-metrics@1.30.0");
    expect(hygieneHtml).toContain("@opentelemetry/sdk-metrics@2.x");

    // Recent Merges tab renders merged PR history
    const mergedHtml = renderRenovatePage("/renovate?tab=merged", renovate);
    expect(mergedHtml).toContain("Recently merged Renovate pull requests");
    expect(mergedHtml).toContain("#4805");
    expect(mergedHtml).toContain("uplot to v1.6.32");
  });
});
