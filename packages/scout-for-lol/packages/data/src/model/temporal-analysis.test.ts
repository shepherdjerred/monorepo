import { describe, expect, test } from "bun:test";
import { parseAndCompile } from "#src/model/report-query-compile.ts";
import { formatReportQuery } from "#src/model/report-query-format.ts";
import {
  parseTemporalAnalysisClause,
  resolveTemporalBucket,
  VisualizationSnapshotSchema,
} from "#src/model/temporal-analysis.ts";

const BASE = "SELECT games, win_rate FROM match_participants GROUP BY player";

describe("canonical ScoutQL temporal analysis", () => {
  test("compiles clauses in canonical order and appends the resolved bucket", () => {
    const plan = parseAndCompile(`${BASE}
      ANALYZE LAST 90 DAYS
      BUCKET BY WEEK
      COMPARE TO PREVIOUS PERIOD
      IN TIME ZONE 'America/Los_Angeles'
      ORDER BY label ASC
      RENDER line_chart WITH (y = (games, win_rate), rolling = 3, trend = true, sparkline = true)`);

    expect(plan.groupBys).toEqual(["player", "week"]);
    expect(plan.limit).toBe(2000);
    expect(plan.analysis).toEqual({
      window: { kind: "relative", days: 90 },
      bucket: "week",
      comparison: { kind: "previous_period" },
      timezone: "America/Los_Angeles",
    });
  });

  test("formats inclusive dates and an equal-length custom baseline", () => {
    const formatted = formatReportQuery(`${BASE}
      analyze between '2026-03-01' and '2026-03-31'
      bucket by day
      compare to between '2026-02-01' and '2026-03-03'
      in time zone 'UTC'
      render calendar_heatmap with (y = games)`);
    expect(formatted).toContain(
      "ANALYZE BETWEEN '2026-03-01' AND '2026-03-31'",
    );
    expect(formatted).toContain(
      "COMPARE TO BETWEEN '2026-02-01' AND '2026-03-03'",
    );
  });

  test("rejects report windows above 365 days", () => {
    expect(() =>
      parseAndCompile(`${BASE} ANALYZE LAST 366 DAYS IN TIME ZONE 'UTC'`),
    ).toThrow("cannot exceed 365 days");
  });

  test("rejects temporal clauses for current-rank sources", () => {
    for (const source of ["rank_current", "competition_rank"]) {
      expect(() =>
        parseAndCompile(
          `SELECT player, score FROM ${source} GROUP BY player ANALYZE LAST 30 DAYS IN TIME ZONE 'UTC'`,
        ),
      ).toThrow(`ANALYZE is not available for ${source}`);
    }
  });

  test("rejects temporal sources that do not retain the required time dimension", () => {
    expect(() =>
      parseAndCompile(
        "SELECT games FROM player_groups GROUP BY group(2) ANALYZE LAST 30 DAYS BUCKET BY DAY IN TIME ZONE 'UTC' ORDER BY games DESC",
      ),
    ).toThrow("group facts do not retain match timestamps");
    expect(() =>
      parseAndCompile(
        "SELECT games FROM prematch_participants GROUP BY all ANALYZE LAST 30 DAYS BUCKET BY PATCH IN TIME ZONE 'UTC' ORDER BY games DESC",
      ),
    ).toThrow("prematch observations do not contain a game version");
  });

  test("rejects ambiguous canonical and legacy temporal controls", () => {
    expect(() =>
      parseAndCompile(
        "SELECT games, win_rate FROM match_participants WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL '30 days' GROUP BY player ANALYZE LAST 30 DAYS IN TIME ZONE 'UTC'",
      ),
    ).toThrow("Do not combine ANALYZE");
    expect(() =>
      parseAndCompile(
        "SELECT games FROM match_participants GROUP BY week ANALYZE LAST 30 DAYS BUCKET BY DAY IN TIME ZONE 'UTC'",
      ),
    ).toThrow("Do not combine ANALYZE");
  });

  test("requires equal custom comparison lengths", () => {
    expect(() =>
      parseTemporalAnalysisClause(
        "BETWEEN '2026-01-01' AND '2026-01-31' COMPARE TO BETWEEN '2025-12-01' AND '2025-12-30' IN TIME ZONE 'UTC'",
      ),
    ).toThrow("same length");
  });

  test("uses documented automatic bucket thresholds", () => {
    expect(resolveTemporalBucket("auto", 60)).toBe("day");
    expect(resolveTemporalBucket("auto", 61)).toBe("week");
    expect(resolveTemporalBucket("auto", 365)).toBe("week");
    expect(resolveTemporalBucket("auto", 366)).toBe("month");
  });

  test("validates cumulative transforms against output expression semantics", () => {
    expect(() =>
      parseAndCompile(
        "SELECT wins / games AS rate FROM match_participants GROUP BY all ANALYZE LAST 30 DAYS BUCKET BY DAY IN TIME ZONE 'UTC' RENDER line_chart WITH (y = rate, cumulative = true)",
      ),
    ).toThrow("rate is not additive");
    expect(() =>
      parseAndCompile(
        "SELECT largest_multikill FROM match_participants GROUP BY all ANALYZE LAST 30 DAYS BUCKET BY DAY IN TIME ZONE 'UTC' RENDER line_chart WITH (y = largest_multikill, cumulative = true)",
      ),
    ).toThrow("largest_multikill is not additive");
    expect(() =>
      parseAndCompile(
        "SELECT longest_life_seconds FROM match_participants GROUP BY all ANALYZE LAST 30 DAYS BUCKET BY DAY IN TIME ZONE 'UTC' RENDER line_chart WITH (y = longest_life_seconds, cumulative = true)",
      ),
    ).toThrow("longest_life_seconds is not additive");
    expect(
      parseAndCompile(
        "SELECT kills + assists AS takedowns FROM match_participants GROUP BY all ANALYZE LAST 30 DAYS BUCKET BY DAY IN TIME ZONE 'UTC' RENDER line_chart WITH (y = takedowns, cumulative = true)",
      ).render,
    ).toMatchObject({ options: { cumulative: true } });
  });

  test("supports requested table sparklines and static image parity", () => {
    const plan = parseAndCompile(
      `${BASE} ANALYZE LAST 30 DAYS BUCKET BY DAY IN TIME ZONE 'UTC' RENDER table WITH (sparkline = true)`,
    );
    expect(plan.render).toEqual({
      kind: "TABLE",
      options: { sparkline: true },
    });
  });

  test("allows KPI cards to retain the appended temporal bucket", () => {
    const plan = parseAndCompile(
      "SELECT games, win_rate FROM match_participants GROUP BY all ANALYZE LAST 30 DAYS BUCKET BY DAY IN TIME ZONE 'UTC' RENDER kpi_card WITH (y = (games, win_rate), sparkline = true)",
    );
    expect(plan.groupBys).toEqual(["day"]);
    expect(plan.render.kind).toBe("KPI_CARD");
  });

  test("enforces the total visualization point ceiling", () => {
    const point = {
      key: "2026-01-01",
      label: "2026-01-01",
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-01T23:59:59.999Z",
      value: 1,
      evidence: { sampleSize: 1, confidenceInterval: null },
    };
    expect(() =>
      VisualizationSnapshotSchema.parse({
        version: 1,
        generatedAt: "2026-08-08T00:00:00.000Z",
        kind: "LINE_CHART",
        title: null,
        temporal: null,
        bucket: null,
        display: {
          theme: null,
          palette: null,
          smooth: false,
          stack: "none",
          rollingWindow: null,
          cumulative: false,
          sparkline: false,
        },
        series: [
          {
            id: "games",
            label: "Games",
            metric: "games",
            additive: true,
            points: Array.from({ length: 2001 }, () => point),
          },
        ],
        annotations: [],
        trends: [],
      }),
    ).toThrow("at most 2000 points");
  });
});
