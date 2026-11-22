import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  planSeries,
  REVIEW_QUERIES,
  SERIES_PRESETS,
  SERIES_RANGE_SECONDS,
} from "#domain/ops-series";
import {
  SERIES_PRESET_IDS,
  SERIES_RANGES,
  SeriesInputSchema,
} from "#shared/ops-schema";

describe("series presets", () => {
  it("defines exactly the allowlisted presets", () => {
    expect(Object.keys(SERIES_PRESETS).toSorted()).toEqual(
      [...SERIES_PRESET_IDS].toSorted(),
    );
    expect(SERIES_PRESET_IDS.length).toBeGreaterThanOrEqual(58);
  });

  it("rejects raw PromQL, unknown presets, and unsafe targets at the input boundary", () => {
    expect(SeriesInputSchema.safeParse({ preset: "up" }).success).toBe(false);
    expect(
      SeriesInputSchema.safeParse({ preset: "sum(rate(x[5m]))" }).success,
    ).toBe(false);
    expect(
      SeriesInputSchema.safeParse({ preset: "prs-open", range: "1y" }).success,
    ).toBe(false);
    expect(
      SeriesInputSchema.safeParse({
        preset: "namespace-cpu",
        target: 'scout"} or vector(1) #',
      }).success,
    ).toBe(false);
    expect(
      SeriesInputSchema.safeParse({
        preset: "namespace-cpu",
        target: "scout.*",
      }).success,
    ).toBe(false);
    expect(SeriesInputSchema.parse({ preset: "prs-open" }).range).toBe("7d");
  });

  it.each(SERIES_RANGES)(
    "plans %s on a step-aligned grid with every placeholder filled",
    (range) => {
      const now = 1_790_000_123;
      for (const preset of SERIES_PRESET_IDS) {
        for (const query of planSeries(preset, range, now)) {
          expect(query.promql).not.toContain("{window}");
          expect(query.promql).not.toContain("{window_seconds}");
          expect(query.promql).not.toContain("{target}");
          expect(query.endSeconds % query.stepSeconds).toBe(0);
          expect(query.endSeconds - query.startSeconds).toBe(
            SERIES_RANGE_SECONDS[range].durationSeconds,
          );
          expect(
            (query.endSeconds - query.startSeconds) / query.stepSeconds,
          ).toBeLessThanOrEqual(300);
        }
      }
    },
  );

  it("substitutes validated targets and defaults omitted targets to .+", () => {
    const now = 1_790_000_000;
    const [defaultQuery] = planSeries("namespace-cpu", "24h", now);
    expect(defaultQuery?.promql).toContain('namespace=~".+"');

    const [scoped] = planSeries(
      "namespace-cpu",
      "24h",
      now,
      "scout-beta|scout-prod",
    );
    expect(scoped?.promql).toContain('namespace=~"scout-beta|scout-prod"');

    const [dotted] = planSeries("service-span-rate", "24h", now, "sjer.red");
    expect(dotted?.promql).toContain(String.raw`service=~"sjer\.red"`);

    expect(() => planSeries("namespace-cpu", "24h", now, 'bad"target')).toThrow(
      z.ZodError,
    );
  });

  it("applies the PromQL label and scrape-scoping fixes", () => {
    expect(SERIES_PRESETS["cluster-llm-cost"].queries[0]).toMatchObject({
      legendLabel: "exported_service",
    });
    expect(SERIES_PRESETS["cluster-llm-cost"].queries[0]?.promql).toContain(
      "sum by (exported_service, workload, model)",
    );
    expect(SERIES_PRESETS["provider-billed-cost"].queries[0]?.promql).toBe(
      'sum by (provider) (last_over_time(llm_billed_cost_usd{window="today"}[2h]))',
    );
    expect(SERIES_PRESETS["prs-merged"].queries[0]).toMatchObject({
      promql: "sum by (author_class) (github_pull_requests_merged_7d)",
      legendLabel: "author_class",
    });
    expect(SERIES_PRESETS["node-cpu"].queries[0]?.legendLabel).toBe("node");
    expect(SERIES_PRESETS["node-cpu"].queries[0]?.promql).toContain(
      "kube_pod_info",
    );
    expect(SERIES_PRESETS["node-memory"].queries[0]?.legendLabel).toBe("node");
    expect(SERIES_PRESETS["delivery-active"].queries[0]?.promql).toContain(
      'job="delivery"',
    );
    expect(SERIES_PRESETS["delivery-outcomes"].queries[0]?.promql).toContain(
      'job="delivery"',
    );
    expect(SERIES_PRESETS["postal-queued"].queries[0]?.promql).toContain(
      'job="postal-mariadb"',
    );
    expect(SERIES_PRESETS["scout-guilds"].queries[0]?.promql).toContain(
      "max by (environment)",
    );
    expect(SERIES_PRESETS["scout-matches"].queries[0]?.promql).toContain(
      "max by (environment)",
    );
    expect(SERIES_PRESETS["plex-watch-hours"].queries[0]?.promql).toContain(
      'job="media-plex-metrics-service"',
    );
    expect(SERIES_PRESETS["plex-watch-hours"].queries[0]?.promql).not.toContain(
      "plex_",
    );
  });

  it("never shrinks rate windows below five minutes", () => {
    const [query] = planSeries("node-cpu", "24h", 1_790_000_000);
    expect(query?.promql).toContain("[300s]");
  });

  it("places the review offset after the range selector", () => {
    expect(REVIEW_QUERIES.llmSpendPrevious7d).toContain("[7d] offset 7d)");
    expect(REVIEW_QUERIES.llmSpendPrevious7d).not.toContain("offset 7d]");
  });
});
