import { describe, expect, it } from "vitest";

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
  });

  it("rejects raw PromQL and unknown presets at the input boundary", () => {
    expect(SeriesInputSchema.safeParse({ preset: "up" }).success).toBe(false);
    expect(
      SeriesInputSchema.safeParse({ preset: "sum(rate(x[5m]))" }).success,
    ).toBe(false);
    expect(
      SeriesInputSchema.safeParse({ preset: "prs-open", range: "1y" }).success,
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

  it("never shrinks rate windows below five minutes", () => {
    const [query] = planSeries("node-cpu", "24h", 1_790_000_000);
    expect(query?.promql).toContain("[300s]");
  });

  it("places the review offset after the range selector", () => {
    expect(REVIEW_QUERIES.llmSpendPrevious7d).toContain("[7d] offset 7d)");
    expect(REVIEW_QUERIES.llmSpendPrevious7d).not.toContain("offset 7d]");
  });
});
