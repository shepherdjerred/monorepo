import { Temporal } from "@js-temporal/polyfill";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { digestPeriodKey } from "#domain/ops-period";
import { fixedClock } from "#shared/time";
import { createOpsFixture } from "#test-fixtures/ops-services";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";
import { seedReportFixtures } from "#test-fixtures/reports-fixture";

import { DigestRunPage } from "./digest-run-page.tsx";
import { IncidentMailPage } from "./incident-mail-page.tsx";
import { ReportRunPage } from "./report-run-page.tsx";
import { reportsKeys } from "./reports-api.ts";
import {
  automationModeMeta,
  dayCellLabel,
  formatDuration,
  parseDetailViewMode,
  parseReportsFeedParams,
} from "./reports-format.ts";
import { buildReportsKpis, ReportsPage } from "./reports-page.tsx";

const NOW = "2026-11-22T18:00:00Z";

async function seededFixture() {
  const now = Temporal.Instant.from(NOW);
  const fixture = createOpsFixture(fixedClock(NOW));
  await fixture.ops.ingest(
    JSON.stringify(fixtureOpsIngest(now.subtract({ minutes: 2 }).toString())),
  );
  await seedReportFixtures({
    reportsRepository: fixture.reportsRepository,
    opsRepository: fixture.repository,
    now,
  });
  return { fixture, now };
}

function renderWithRouter(
  initialEntry: string,
  setupCache: (client: QueryClient) => void,
): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  setupCache(queryClient);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/runs/:id" element={<ReportRunPage />} />
          <Route
            path="/reports/digests/:kind/:periodKey"
            element={<DigestRunPage />}
          />
          <Route path="/reports/mail/:id" element={<IncidentMailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Reports URL parsing and formatting helpers", () => {
  it("parses feed query params and view modes safely", () => {
    const parsed = parseReportsFeedParams(
      new URLSearchParams(
        "tab=reports&scheduleId=link-rot-scan-weekly&mailbox=reports@sjer.red&verdict=changed&delivery=sent&hasPr=1&q=redirect",
      ),
    );
    expect(parsed).toEqual({
      tab: "reports",
      scheduleId: "link-rot-scan-weekly",
      mailbox: "reports@sjer.red",
      verdict: "changed",
      delivery: "sent",
      hasPr: "1",
      q: "redirect",
    });

    expect(parseReportsFeedParams(new URLSearchParams("tab=invalid"))).toEqual({
      tab: "all",
    });
    expect(parseDetailViewMode("email")).toBe("email");
    expect(parseDetailViewMode("inspector")).toBe("inspector");
    expect(parseDetailViewMode(null)).toBe("inspector");
  });

  it("maps automation modes, day cell labels, and durations cleanly", () => {
    expect(automationModeMeta("llm-pr-automerge").label).toBe("Auto-merge PR");
    expect(automationModeMeta("llm-pr-review").label).toBe("LLM Review PR");
    expect(automationModeMeta("deterministic-pr").label).toBe(
      "Deterministic PR",
    );
    expect(
      dayCellLabel({
        date: "2026-11-22",
        state: "changed",
        runCount: 1,
        prUrl: "https://github.com/shepherdjerred/monorepo/pull/3071",
      }),
    ).toBe("Nov 22: PR opened (1 run)");
    expect(
      dayCellLabel({
        date: "2026-11-21",
        state: "quiet-clear",
        runCount: 1,
      }),
    ).toBe("Nov 21: Quiet in Hub, clear (1 run)");
    expect(formatDuration("2026-11-22T18:00:00Z", "2026-11-22T18:02:15Z")).toBe(
      "2m 15s",
    );
  });
});

describe("ReportsPage and deep-dive inspector rendering", () => {
  it("renders the 5 KPI cards, 14-stream schedule matrix, remediation badges, and filtered feed", async () => {
    const { fixture } = await seededFixture();
    const overview = await fixture.reports.overview();
    const feed = await fixture.reports.feed({});

    const kpis = buildReportsKpis(overview.kpis);
    expect(kpis.map((item) => item.label)).toEqual([
      "Needs Review",
      "Automated PRs (7d)",
      "Quiet Heartbeats (7d)",
      "Schedule Freshness",
      "Incident Outbox",
    ]);
    expect(kpis[0]?.sev).toBe("warning");

    const html = renderWithRouter("/reports", (client) => {
      client.setQueryData(reportsKeys.overview(), overview);
      client.setQueryData(reportsKeys.feed({ tab: "all" }), feed);
    });

    expect(html).toContain("<title>Reports · Hub</title>");
    expect(html).toContain('aria-label="Recurring report schedules"');
    expect(html).toContain("Weekly link-rot scan");
    expect(html).toContain("The Storm promotion summary");
    expect(html).toContain("Auto-merge PR");
    expect(html).toContain("LLM Review PR");
    expect(html).toContain("Quiet in Hub");
    expect(html).toContain("14 / 14");
    expect(html).toContain("0 pending · 0 failed");
  });

  it("filters schedule matrix by semantic mailbox query param", async () => {
    const { fixture } = await seededFixture();
    const overview = await fixture.reports.overview();
    const scoutFeed = await fixture.reports.feed({ mailbox: "scout@sjer.red" });

    const html = renderWithRouter(
      "/reports?mailbox=scout%40sjer.red",
      (client) => {
        client.setQueryData(reportsKeys.overview(), overview);
        client.setQueryData(
          reportsKeys.feed({ tab: "all", mailbox: "scout@sjer.red" }),
          scoutFeed,
        );
      },
    );

    expect(html).toContain("Scout Data Dragon patch check");
    expect(html).toContain("Scout queue windows watcher");
    expect(html).not.toContain("Weekly link-rot scan");
  });

  it("keeps search controls mounted and preserves trailing spaces while filtered feed loads", async () => {
    const { fixture } = await seededFixture();
    const overview = await fixture.reports.overview();

    const html = renderWithRouter("/reports?q=certificate%20", (client) => {
      client.setQueryData(reportsKeys.overview(), overview);
    });

    expect(html).toContain('type="search"');
    expect(html).toContain('value="certificate "');
  });

  it("renders ReportRunPage inspector and rendered email preview modes", async () => {
    const { fixture } = await seededFixture();
    const detail = await fixture.reports.runDetail(
      "main-vuln-scan-weekly:latest",
    );
    expect(detail).not.toBeNull();

    const inspectorHtml = renderWithRouter(
      "/reports/runs/main-vuln-scan-weekly%3Alatest",
      (client) => {
        client.setQueryData(
          reportsKeys.run("main-vuln-scan-weekly:latest"),
          detail,
        );
      },
    );

    expect(inspectorHtml).toContain("Remediation &amp; next steps");
    expect(inspectorHtml).toContain("Awaiting human review");
    expect(inspectorHtml).toContain("auto/vuln-remediation");
    expect(inspectorHtml).toContain("package.json");
    expect(inspectorHtml).toContain("Synthesis &amp; coverage boundaries");
    expect(inspectorHtml).toContain(
      "Moderate advisory awaiting upstream patch release",
    );
    expect(inspectorHtml).toContain(
      "Previously tracked lodash advisory resolved on main",
    );
    expect(inspectorHtml).toContain("Workspace vulnerability audit");
    expect(inspectorHtml).toContain("Container &amp; filesystem scan");
    expect(inspectorHtml).toContain("bun audit --json");
    expect(inspectorHtml).toContain("GHSA-sample-1");
    expect(inspectorHtml).toContain("Recent schedule runs");

    const emailHtml = renderWithRouter(
      "/reports/runs/main-vuln-scan-weekly%3Alatest?view=email",
      (client) => {
        client.setQueryData(
          reportsKeys.run("main-vuln-scan-weekly:latest"),
          detail,
        );
      },
    );

    expect(emailHtml).toContain('title="Rendered email preview"');
    expect(emailHtml).toContain('sandbox=""');
    expect(emailHtml).toContain(
      "&lt;main-vuln-scan-weekly-latest@sjer.red&gt;",
    );
  });

  it("renders DigestRunPage and IncidentMailPage deep-dive views", async () => {
    const { fixture, now } = await seededFixture();
    const yesterdayKey = digestPeriodKey("daily", now.subtract({ hours: 24 }));
    const digestDetail = await fixture.reports.digestDetail(
      "daily",
      yesterdayKey,
    );
    const incidentDetail = await fixture.reports.incidentDetail(
      "123e4567-e89b-42d3-a456-426614174099",
    );

    const digestHtml = renderWithRouter(
      `/reports/digests/daily/${yesterdayKey}`,
      (client) => {
        client.setQueryData(
          reportsKeys.digest("daily", yesterdayKey),
          digestDetail,
        );
      },
    );
    expect(digestHtml).toContain("Quiet in Hub");
    expect(digestHtml).toContain("unchanged-clear");
    expect(digestHtml).toContain("Needs your review");

    const incidentHtml = renderWithRouter(
      "/reports/mail/123e4567-e89b-42d3-a456-426614174099",
      (client) => {
        client.setQueryData(
          reportsKeys.incident("123e4567-e89b-42d3-a456-426614174099"),
          incidentDetail,
        );
      },
    );
    expect(incidentHtml).toContain("Outbox &amp; delivery metadata");
    expect(incidentHtml).toContain("DiskFull");
    expect(incidentHtml).toContain(`/alerts/alert_${"a".repeat(32)}`);
    expect(incidentHtml).toContain('title="Rendered email preview"');
  });
});
