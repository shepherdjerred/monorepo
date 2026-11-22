import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ChartSeries } from "#client/charts/uplot-chart.tsx";

vi.mock("#client/charts/uplot-chart.tsx", () => ({
  UplotChart: ({
    series,
    unit,
    height = 220,
    label,
  }: {
    series: readonly ChartSeries[];
    unit: string;
    height?: number;
    label: string;
  }) =>
    createElement("div", {
      "aria-label": label,
      className: "mock-uplot-chart",
      "data-height": String(height),
      "data-series": String(series.length),
      "data-unit": unit,
      role: "img",
    }),
}));

import {
  Preview,
  deduplicatedAnnotations,
  parsePrometheusMatrixSeries,
} from "./alert-detail-page.tsx";

describe("parsePrometheusMatrixSeries", () => {
  it("parses unwrapped and Grafana-wrapped matrix responses with numeric samples", () => {
    const unwrapped = {
      resultType: "matrix",
      result: [
        {
          metric: { __name__: "up", namespace: "storage", pod: "storage-0" },
          values: [
            [1_723_140_000, "1"],
            [1_723_140_060, "0"],
          ],
        },
      ],
    };
    const wrapped = { status: "success", data: unwrapped };

    expect(parsePrometheusMatrixSeries(unwrapped)).toEqual([
      {
        name: 'namespace="storage", pod="storage-0"',
        points: [
          [1_723_140_000, 1],
          [1_723_140_060, 0],
        ],
      },
    ]);
    expect(parsePrometheusMatrixSeries(wrapped)).toEqual(
      parsePrometheusMatrixSeries(unwrapped),
    );
  });

  it("returns null for vector, scalar, or empty matrix responses", () => {
    expect(
      parsePrometheusMatrixSeries({ resultType: "vector", result: [] }),
    ).toBeNull();
    expect(
      parsePrometheusMatrixSeries({ resultType: "matrix", result: [] }),
    ).toBeNull();
    expect(
      parsePrometheusMatrixSeries({
        resultType: "matrix",
        result: [{ metric: {}, values: [[1_723_140_000, "NaN"]] }],
      }),
    ).toBeNull();
  });
});

describe("Preview component", () => {
  it("renders UplotChart above collapsible Raw Prometheus JSON for matrix data", () => {
    const html = renderToStaticMarkup(
      createElement(Preview, {
        enablePrometheusChart: true,
        title: "Prometheus",
        value: {
          status: "available",
          query: "up",
          data: {
            resultType: "matrix",
            result: [
              {
                metric: { job: "node" },
                values: [
                  [1_723_140_000, "1"],
                  [1_723_140_060, "2"],
                ],
              },
            ],
          },
        },
      }),
    );

    expect(html).toContain("mock-uplot-chart");
    expect(html).toContain('data-unit="count"');
    expect(html).toContain('data-height="200"');
    expect(html).toContain("<details");
    expect(html).toContain("Raw Prometheus JSON</summary>");
    expect(html).toContain("<pre>");
  });

  it("falls back to pre for empty or vector results", () => {
    const html = renderToStaticMarkup(
      createElement(Preview, {
        enablePrometheusChart: true,
        title: "Prometheus",
        value: {
          status: "available",
          query: "up",
          data: { resultType: "vector", result: [] },
        },
      }),
    );

    expect(html).not.toContain("mock-uplot-chart");
    expect(html).not.toContain("Raw Prometheus JSON");
    expect(html).toContain("<pre>");
  });
});

describe("deduplicatedAnnotations", () => {
  it("omits annotations.description when equal to annotations.summary or alert summary", () => {
    expect(
      deduplicatedAnnotations(
        {
          summary: "Storage volume is nearly full",
          description: "Storage volume is nearly full",
          runbook_url: "https://example.com/runbook",
        },
        "Storage volume is nearly full",
      ),
    ).toEqual([
      ["summary", "Storage volume is nearly full"],
      ["runbook_url", "https://example.com/runbook"],
    ]);

    expect(
      deduplicatedAnnotations(
        {
          description: "Storage volume is nearly full",
        },
        "Storage volume is nearly full",
      ),
    ).toEqual([]);
  });

  it("retains annotations.description when it adds distinct detail", () => {
    expect(
      deduplicatedAnnotations(
        {
          summary: "Storage volume is nearly full",
          description: "PVC data-0 is at 94% capacity on worker-2",
        },
        "Storage volume is nearly full",
      ),
    ).toEqual([
      ["summary", "Storage volume is nearly full"],
      ["description", "PVC data-0 is at 94% capacity on worker-2"],
    ]);
  });
});
