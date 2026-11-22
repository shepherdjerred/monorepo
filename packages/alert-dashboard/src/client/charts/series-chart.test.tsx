import { Loaded } from "@shepherdjerred/loaded";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SeriesResponse } from "#shared/ops-schema";

vi.mock("#client/theme.ts", () => ({
  useResolvedTheme: () => "light",
}));

const { SeriesChartPanel } = await import("./series-chart.tsx");

const SAMPLE_RESPONSE: SeriesResponse = {
  preset: "ai-cost-by-source",
  range: "7d",
  title: "AI cost by source",
  unit: "usd",
  stepSeconds: 3600,
  start: 1_700_000_000,
  end: 1_700_007_200,
  series: [
    {
      name: "claude-code",
      points: [
        [1_700_000_000, 12.5],
        [1_700_003_600, 18.25],
      ],
    },
    {
      name: "codex",
      points: [
        [1_700_000_000, 4.1],
        [1_700_003_600, 6.4],
      ],
    },
  ],
};

describe("SeriesChartPanel", () => {
  it("renders a zero-CLS placeholder stage while loading", () => {
    const html = renderToStaticMarkup(
      <SeriesChartPanel
        value={Loaded.loading()}
        range="7d"
        subtitle="Rolling hourly rate"
        target="node-a"
        onRetry={vi.fn()}
      />,
    );
    expect(html).toContain('class="chart-panel"');
    expect(html).toContain('data-target="node-a"');
    expect(html).toContain("Loading…");
    expect(html).toContain("Rolling hourly rate");
    expect(html).toContain('class="visual-chart-stage"');
    expect(html).toContain('class="chart-placeholder" aria-busy="true"');
  });

  it("renders an alert with a Retry button when the query fails", () => {
    const html = renderToStaticMarkup(
      <SeriesChartPanel
        value={Loaded.failed(new Error("timeout"))}
        range="24h"
        title="Node CPU"
        onRetry={vi.fn()}
      />,
    );
    expect(html).toContain("Node CPU");
    expect(html).toContain('class="chart-error" role="alert"');
    expect(html).toContain("Prometheus did not answer for this chart.");
    expect(html).toContain(
      '<button type="button" class="button visual-chart-retry">Retry</button>',
    );
  });

  it("renders StaleNotice alongside cached series data when degraded", () => {
    const html = renderToStaticMarkup(
      <SeriesChartPanel
        value={Loaded.degraded(SAMPLE_RESPONSE, [
          { path: ["series"], error: new Error("502") },
        ])}
        range="7d"
        mode="stacked-area"
        threshold={{ value: 25, label: "$25 cap", tone: "warning" }}
        syncKey="ai-charts"
        onRetry={vi.fn()}
      />,
    );
    expect(html).toContain('class="stale-state" role="status"');
    expect(html).toContain("Showing the last known data");
    expect(html).toContain('data-chart-mode="stacked-area"');
    expect(html).toContain("claude-code $18.25, codex $6.40");
  });

  it("renders the empty state inside the chart stage when no points exist", () => {
    const emptyResponse: SeriesResponse = {
      ...SAMPLE_RESPONSE,
      series: [{ name: "claude-code", points: [] }],
    };
    const html = renderToStaticMarkup(
      <SeriesChartPanel
        value={Loaded.done(emptyResponse)}
        range="30d"
        onRetry={vi.fn()}
      />,
    );
    expect(html).toContain('class="chart-empty"');
    expect(html).toContain("No samples in this range yet.");
  });
});
