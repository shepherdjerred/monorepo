import { describe, expect, test } from "vitest";
import { completeScoutQl } from "#src/model/scoutql/complete.ts";
import {
  renderOptionNames,
  type ScoutQlCompletionItem,
} from "#src/model/scoutql/complete-items.ts";
import { lintScoutQl } from "#src/model/scoutql/lint.ts";
import { ReportOutputFormatSchema } from "#src/model/reports/report.ts";

// ── Completion ───────────────────────────────────────────────────────────────
// The cursor is written as `|` in these fixtures. What is asserted is the
// CONTEXT decision — which vocabulary a position offers — not the ranking,
// which the editor's own matcher owns.

function at(fixture: string): ScoutQlCompletionItem[] {
  const offset = fixture.indexOf("|");
  expect(offset).toBeGreaterThanOrEqual(0);
  return completeScoutQl(fixture.replace("|", ""), offset);
}

function labels(fixture: string): string[] {
  return at(fixture).map((item) => item.label);
}

const BOUND = "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY";
const BASE = `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate FROM match_participants WHERE ${BOUND} GROUP BY player`;

describe("clause vocabulary", () => {
  test("after FROM, the sources", () => {
    expect(labels("SELECT COUNT(*) AS games FROM |")).toEqual([
      "competition_match_participants",
      "competition_rank",
      "match_participants",
      "player_groups",
      "prematch_participants",
      "rank_current",
    ]);
  });

  test("in SELECT, this source's columns plus aggregates and idioms", () => {
    const offered = labels(
      "SELECT | FROM match_participants WHERE " + BOUND + " GROUP BY player",
    );
    expect(offered).toContain("kills");
    expect(offered).toContain("champion");
    expect(offered).toContain("COUNT(…)");
    expect(offered).toContain("QUANTILE_CONT(…)");
    expect(offered).toContain("Conditional aggregate with FILTER");
    // A column of another source is not on offer.
    expect(offered).not.toContain("score");
  });

  test("inside an aggregate, no nested aggregate is offered", () => {
    const offered = labels(
      `SELECT AVG(|) AS x FROM match_participants WHERE ${BOUND} GROUP BY player`,
    );
    expect(offered).toContain("kills");
    expect(offered).toContain("ROUND(…)");
    expect(offered).not.toContain("COUNT(…)");
    expect(offered).not.toContain("AVG(…)");
  });

  test("in WHERE, filterable columns and references but no aggregates", () => {
    const offered = labels(
      "SELECT COUNT(*) AS games FROM match_participants WHERE |",
    );
    expect(offered).toContain("queue");
    expect(offered).toContain("player(…)");
    expect(offered).toContain("champion(…)");
    expect(offered).toContain("A rolling time bound");
    expect(offered).not.toContain("SUM(…)");
  });

  test("in a queue IN list, the queues Scout records", () => {
    const items = at(
      "SELECT COUNT(*) AS games FROM match_participants WHERE queue IN (|)",
    );
    const queues = items.filter((item) => item.kind === "value");
    expect(queues.map((item) => item.label)).toContain("solo");
    expect(queues.find((item) => item.label === "solo")?.insertText).toBe(
      "'solo'",
    );
  });

  test("after `queue = `, the same queue values", () => {
    const offered = labels(
      "SELECT COUNT(*) AS games FROM match_participants WHERE queue = |",
    );
    expect(offered).toContain("aram");
  });

  test("HAVING offers this query's outputs first", () => {
    const items = at(`${BASE} HAVING |`);
    expect(items[0]?.kind).toBe("alias");
    expect(items.slice(0, 3).map((item) => item.label)).toContain("games");
    expect(items.map((item) => item.label)).toContain("win_rate");
  });

  test("ORDER BY offers outputs and groupings", () => {
    const offered = labels(`${BASE} ORDER BY |`);
    expect(offered).toContain("games");
    expect(offered).toContain("win_rate");
    expect(offered).toContain("DESC");
  });

  test("an empty document offers SELECT and complete recipes", () => {
    const items = at("|");
    expect(items.map((item) => item.label)).toContain("SELECT");
    const starter = items.find((item) => item.kind === "snippet");
    expect(starter?.insertText).toContain("SELECT");
    expect(lintScoutQl(starter?.insertText ?? "")).toEqual([]);
  });
});

describe("RENDER", () => {
  test("after RENDER, the render kinds", () => {
    const offered = labels(`${BASE} RENDER |`);
    expect(offered).toContain("bar_chart");
    expect(offered).toContain("histogram");
    expect(offered).toContain("box_plot");
    expect(offered).toHaveLength(ReportOutputFormatSchema.options.length);
  });

  test("inside WITH, the options that kind accepts", () => {
    const offered = labels(`${BASE} RENDER bar_chart WITH (|)`);
    expect(offered).toContain("y");
    expect(offered).toContain("palette");
    expect(offered).toContain("compare");
    expect(offered).not.toContain("mentions");
  });

  test("text kinds have their own, much shorter, option lists", () => {
    expect(labels(`${BASE} RENDER table WITH (|)`)).toEqual(["sparkline"]);
    expect(labels(`${BASE} RENDER leaderboard WITH (|)`)).toEqual(["mentions"]);
    expect(labels(`${BASE} RENDER list WITH (|)`)).toEqual([]);
  });

  test("after `=`, the values that option accepts", () => {
    expect(labels(`${BASE} RENDER bar_chart WITH (palette = |)`)).toEqual([
      "categorical",
      "colorblind",
      "gold",
      "ranked",
      "team",
    ]);
    expect(labels(`${BASE} RENDER bar_chart WITH (smooth = |)`)).toEqual([
      "false",
      "true",
    ]);
    expect(labels(`${BASE} RENDER bar_chart WITH (compare = |)`)).toEqual([
      "previous_period",
    ]);
  });

  test("a channel option offers the query's own outputs", () => {
    expect(labels(`${BASE} RENDER bar_chart WITH (y = |)`)).toEqual([
      "games",
      "player",
      "win_rate",
    ]);
  });

  test("a second option after a comma is still an option name", () => {
    const offered = labels(`${BASE} RENDER bar_chart WITH (y = games, |)`);
    expect(offered).toContain("palette");
    expect(offered).not.toContain("games");
  });
});

describe("offered render options are real options", () => {
  // The option tables in complete-items.ts mirror the analyzer's. This walks
  // every name through the analyzer so a drifted entry fails here rather than
  // being suggested forever.
  for (const format of ReportOutputFormatSchema.options) {
    test(format, () => {
      for (const option of renderOptionNames(format)) {
        const query = `${BASE} RENDER ${format.toLowerCase()} WITH (${option} = 1)`;
        expect(
          lintScoutQl(query).map((diagnostic) => diagnostic.code),
        ).not.toContain("unknown-render-option");
      }
    });
  }

  test("a name that is not an option is rejected", () => {
    expect(
      lintScoutQl(`${BASE} RENDER bar_chart WITH (nonsense = 1)`).map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("unknown-render-option");
  });
});

describe("item shape", () => {
  test("results are ordered by sort group", () => {
    const items = at(`${BASE} HAVING |`);
    const groups = items.map((item) => item.sortGroup);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
  });

  test("snippet bodies are marked as snippets, plain text is not", () => {
    const items = at(
      `SELECT | FROM match_participants WHERE ${BOUND} GROUP BY player`,
    );
    for (const item of items) {
      expect(item.insertTextFormat).toBe(
        item.insertText.includes("${") ? "snippet" : "plain",
      );
    }
  });
});
