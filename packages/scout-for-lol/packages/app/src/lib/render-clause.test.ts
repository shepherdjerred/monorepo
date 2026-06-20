import { describe, expect, test } from "bun:test";
import {
  buildRenderClause,
  isChartKind,
  renderKindFromQuery,
  renderYFromQuery,
  upsertRenderClause,
} from "#src/lib/render-clause.ts";

const BASE =
  "select player, games, win_rate from match_participants group by player order by games desc";

describe("renderKindFromQuery", () => {
  test("defaults to TABLE with no clause", () => {
    expect(renderKindFromQuery(BASE)).toBe("TABLE");
  });

  test("reads the trailing kind", () => {
    expect(renderKindFromQuery(`${BASE} render bar_chart`)).toBe("BAR_CHART");
    expect(renderKindFromQuery(`${BASE} RENDER leaderboard`)).toBe(
      "LEADERBOARD",
    );
  });

  test("ignores a 'render' substring inside a WHERE literal", () => {
    // Regression for the first-match bug: a `%render%` literal sits before
    // GROUP BY and must not be treated as the clause.
    const q =
      "select player, games from match_participants where championName like '%render%' group by player order by games desc render bar_chart";
    expect(renderKindFromQuery(q)).toBe("BAR_CHART");
  });

  test("a WHERE literal with no real clause yields TABLE, not a phantom kind", () => {
    const q =
      "select player, games from match_participants where championName like '%render%' group by player order by games desc";
    expect(renderKindFromQuery(q)).toBe("TABLE");
  });
});

describe("renderYFromQuery", () => {
  test("extracts the y channel", () => {
    expect(
      renderYFromQuery(`${BASE} render bar_chart with (y = win_rate)`),
    ).toBe("win_rate");
  });

  test("returns empty when absent", () => {
    expect(renderYFromQuery(`${BASE} render bar_chart`)).toBe("");
  });

  test("does not read a 'with (y = ...)' from before the clause", () => {
    const q =
      "select player, games from match_participants where note like '%with (y = fake)%' group by player order by games desc render bar_chart with (y = win_rate)";
    expect(renderYFromQuery(q)).toBe("win_rate");
  });
});

describe("upsertRenderClause", () => {
  test("appends when no clause exists", () => {
    expect(upsertRenderClause(BASE, "RENDER bar_chart")).toBe(
      `${BASE} RENDER bar_chart`,
    );
  });

  test("replaces an existing clause", () => {
    const withClause = `${BASE} render bar_chart with (y = games)`;
    expect(upsertRenderClause(withClause, "RENDER leaderboard")).toBe(
      `${BASE} RENDER leaderboard`,
    );
  });

  test("does not truncate at a 'render' substring inside a WHERE literal", () => {
    // The bug this guards against: matching the first "render" would slice the
    // query at the WHERE literal, destroying the body.
    const q =
      "select player, games from match_participants where championName like '%render%' group by player order by games desc render bar_chart";
    expect(upsertRenderClause(q, "RENDER leaderboard")).toBe(
      "select player, games from match_participants where championName like '%render%' group by player order by games desc RENDER leaderboard",
    );
  });
});

describe("buildRenderClause / isChartKind", () => {
  test("chart kinds carry the y channel", () => {
    expect(buildRenderClause("BAR_CHART", "win_rate")).toBe(
      "RENDER bar_chart WITH (y = win_rate)",
    );
  });

  test("chart kind without a y omits the WITH clause", () => {
    expect(buildRenderClause("BAR_CHART", "")).toBe("RENDER bar_chart");
  });

  test("text kinds never carry a y channel", () => {
    expect(buildRenderClause("LEADERBOARD", "win_rate")).toBe(
      "RENDER leaderboard",
    );
  });

  test("isChartKind only matches chart kinds", () => {
    expect(isChartKind("BAR_CHART")).toBe(true);
    expect(isChartKind("LINE_CHART")).toBe(true);
    expect(isChartKind("TABLE")).toBe(false);
    expect(isChartKind("LEADERBOARD")).toBe(false);
  });
});
