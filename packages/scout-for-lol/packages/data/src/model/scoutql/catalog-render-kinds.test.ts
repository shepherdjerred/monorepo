import { describe, expect, test } from "vitest";
import { ReportOutputFormatSchema } from "#src/model/reports/report.ts";
import {
  isChartRenderKind,
  renderKindToken,
  scoutQlRenderKind,
  SCOUTQL_RENDER_KINDS,
} from "#src/model/scoutql/catalog-render-kinds.ts";
import { compileScoutQl } from "#src/model/scoutql/compile.ts";

describe("the render-kind catalog", () => {
  test("covers every render kind the schema accepts, in schema order", () => {
    expect(SCOUTQL_RENDER_KINDS.map((kind) => kind.format)).toEqual([
      ...ReportOutputFormatSchema.options,
    ]);
  });

  test("includes the kinds the legacy registry had fallen behind on", () => {
    const ids = SCOUTQL_RENDER_KINDS.map((kind) => kind.id);
    expect(ids).toContain("histogram");
    expect(ids).toContain("box_plot");
  });

  test("every entry has a real label and description", () => {
    for (const kind of SCOUTQL_RENDER_KINDS) {
      expect(kind.label.length).toBeGreaterThan(0);
      expect(kind.description.length).toBeGreaterThan(0);
      expect(kind.id).toBe(renderKindToken(kind.format));
      expect(scoutQlRenderKind(kind.format)).toEqual(kind);
      expect(isChartRenderKind(kind.format)).toBe(kind.isChart);
    }
  });

  test("every catalogued token is a token the language actually accepts", () => {
    // The catalog is what docs, the app, and the AI payload offer, so an id
    // here that RENDER rejects would be advertised and then refused.
    for (const kind of SCOUTQL_RENDER_KINDS) {
      const query = renderableQuery(kind.id);
      expect(() => compileScoutQl(query)).not.toThrow();
    }
  });
});

/** A minimal query satisfying each kind's shape rules. */
function renderableQuery(id: string): string {
  const from = "FROM match_participants";
  const bound = "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY";
  if (id === "histogram") {
    return `SELECT FLOOR(game_duration_seconds / 300) * 300 AS bucket, COUNT(*) AS games ${from} ${bound} GROUP BY FLOOR(game_duration_seconds / 300) * 300 RENDER histogram`;
  }
  if (id === "box_plot") {
    return (
      `SELECT champion, MIN(kills) AS low, QUANTILE_CONT(kills, 0.25) AS q1, MEDIAN(kills) AS med, ` +
      `QUANTILE_CONT(kills, 0.75) AS q3, MAX(kills) AS high ${from} ${bound} GROUP BY champion ` +
      `RENDER box_plot WITH (y = (low, q1, med, q3, high))`
    );
  }
  if (id === "heatmap") {
    return `SELECT COUNT(*) AS games ${from} ${bound} GROUP BY champion, queue RENDER heatmap`;
  }
  if (id === "radar_chart") {
    return `SELECT COUNT(*) AS games, SUM(kills) AS k, SUM(deaths) AS d ${from} ${bound} GROUP BY champion RENDER radar_chart WITH (y = (games, k, d))`;
  }
  if (id === "scatter_chart") {
    return `SELECT SUM(kills) AS k, SUM(deaths) AS d ${from} ${bound} GROUP BY champion RENDER scatter_chart WITH (x = k, y = d)`;
  }
  if (id === "kpi_card") {
    return `SELECT COUNT(*) AS games ${from} ${bound} RENDER kpi_card`;
  }
  if (id === "bump_chart") {
    return `SELECT DATE_TRUNC('week', game_creation_at) AS week, champion, COUNT(*) AS games ${from} ${bound} GROUP BY DATE_TRUNC('week', game_creation_at), champion RENDER bump_chart`;
  }
  if (id === "calendar_heatmap") {
    return `SELECT DATE_TRUNC('day', game_creation_at) AS day, COUNT(*) AS games ${from} ${bound} GROUP BY DATE_TRUNC('day', game_creation_at) RENDER calendar_heatmap`;
  }
  return `SELECT COUNT(*) AS games ${from} ${bound} GROUP BY champion RENDER ${id}`;
}
