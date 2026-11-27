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
    expect(html).toContain("PR code-review provider pool");
    expect(html).toContain("Architecture boundaries");
    expect(html).toContain("Main dependency vulnerability scan");

    // PR code-review pool section
    expect(html).toContain("PR code review pool");
    expect(html).toContain('aria-label="7d ci/code-review gate outcomes"');
    expect(html).toContain("Code review assignments by provider");
    expect(html).toContain("Code review gate outcomes");
    expect(html).toContain("CodeRabbit");
    expect(html).toContain("$0 free");
    expect(html).toContain("Paid exception");
    expect(html).toContain("22 ok · 2 timeout · 5 limited");

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

  it("renders cooldown warnings and gracefully omits PR code review when absent on older facets", () => {
    const monorepo = requireFixtureFacet("monorepo");
    const legacyHtml = renderMonorepoPage("/monorepo", {
      ...monorepo,
      codeReview: undefined,
    });
    expect(legacyHtml).not.toContain("PR code review pool");

    const baseCodeReview = monorepo.codeReview;
    expect(baseCodeReview).toBeDefined();
    if (baseCodeReview === undefined) {
      return;
    }
    const cooldownHtml = renderMonorepoPage("/monorepo", {
      ...monorepo,
      codeReview: {
        ...baseCodeReview,
        readyProvidersCount: 0,
        coolingDownProvidersCount: 2,
        providers: baseCodeReview.providers.map((p) =>
          p.configuredWeight > 0
            ? {
                ...p,
                status: "cooldown",
                cooldownUntil: "2026-11-26T19:45:00Z",
              }
            : p,
        ),
      },
    });
    expect(cooldownHtml).toContain("Cooldown · 19:45 UTC");
    expect(cooldownHtml).toContain("2 provider(s) cooling down");

    const unavailableHtml = renderMonorepoPage("/monorepo", {
      ...monorepo,
      codeReview: {
        ...baseCodeReview,
        coordinatorObserved: false,
        coordinatorRunning: false,
        coordinatorProcessedCount: 0,
        readyProvidersCount: 0,
        coolingDownProvidersCount: 0,
        providers: baseCodeReview.providers.map((p) =>
          p.configuredWeight > 0 ? { ...p, status: "unknown" } : p,
        ),
      },
    });
    expect(unavailableHtml).toContain("— / 2");
    expect(unavailableHtml).toContain("Coordinator state unavailable");
    expect(unavailableHtml).toContain("Unknown");
  });
});
