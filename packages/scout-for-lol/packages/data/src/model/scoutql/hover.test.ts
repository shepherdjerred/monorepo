import { describe, expect, test } from "vitest";
import { hoverScoutQl } from "#src/model/scoutql/hover.ts";

// ── Hover ────────────────────────────────────────────────────────────────────
// Every assertion here is about resolution THROUGH the analysis: the same
// lexeme must document differently depending on what this query made it.

const BOUND = "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY";
const QUERY = `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate FROM match_participants WHERE queue IN ('solo') AND ${BOUND} GROUP BY player HAVING games >= 10 RENDER bar_chart WITH (y = win_rate)`;

/** Hover at the first occurrence of `lexeme`, or its nth occurrence. */
function hoverAt(text: string, lexeme: string, nth = 0): string | undefined {
  let index = -1;
  for (let seen = 0; seen <= nth; seen++) {
    index = text.indexOf(lexeme, index + 1);
  }
  expect(index).toBeGreaterThanOrEqual(0);
  return hoverScoutQl(text, index + 1)?.markdown;
}

describe("hovering resolves through the analysis", () => {
  test("a column carries its type, description, and source", () => {
    const markdown = hoverAt(QUERY, "queue");
    expect(markdown).toContain("`queue`");
    expect(markdown).toContain("varchar");
    expect(markdown).toContain("Queue name");
    expect(markdown).toContain("match_participants");
  });

  test("the time column says so", () => {
    expect(hoverAt(QUERY, "game_creation_at")).toContain(
      "time windows are recognized",
    );
  });

  test("a virtual dimension is labelled as computed", () => {
    expect(hoverAt(QUERY, "GROUP BY player")).toBeDefined();
    expect(hoverAt(QUERY, "player")).toContain("computed dimension");
  });

  test("an output alias shows the expression it names", () => {
    const markdown = hoverAt(QUERY, "win_rate");
    expect(markdown).toContain("an output of this query");
    expect(markdown).toContain("AVG(win::INT)");
    expect(markdown).toContain("percent");
  });

  test("a HAVING reference resolves to the same output", () => {
    expect(hoverAt(QUERY, "games", 1)).toContain("an output of this query");
  });

  test("a function shows its signatures and result type", () => {
    const markdown = hoverAt(QUERY, "COUNT");
    expect(markdown).toContain("`COUNT(*)`");
    expect(markdown).toContain("`COUNT(DISTINCT x)`");
    expect(markdown).toContain("BIGINT");
  });

  test("a macro documents its expansion", () => {
    expect(
      hoverAt(
        `SELECT kda() AS kda FROM match_participants WHERE ${BOUND} GROUP BY player`,
        "kda",
      ),
    ).toContain("GREATEST(SUM(deaths), 1)");
  });

  test("the FROM target documents the source", () => {
    const markdown = hoverAt(QUERY, "match_participants");
    expect(markdown).toContain("One row per participant");
    expect(markdown).toContain("Time column: `game_creation_at`");
  });

  test("a snapshot source says it has no time column", () => {
    expect(
      hoverAt(
        "SELECT player, MIN(rank) AS best FROM rank_current GROUP BY player",
        "rank_current",
      ),
    ).toContain("No time column");
  });

  test("the render kind explains itself", () => {
    expect(hoverAt(QUERY, "bar_chart")).toContain("a chart");
  });

  test("clause keywords carry a one-line explanation", () => {
    expect(hoverAt(QUERY, "HAVING")).toContain("aggregated rows");
    expect(hoverAt(QUERY, "WHERE")).toContain("before aggregation");
    expect(hoverAt("SELECT CASE FROM match_participants", "CASE")).toContain(
      "not supported",
    );
  });
});

describe("nothing to say", () => {
  test.each([
    [QUERY, QUERY.indexOf("'solo'")],
    [QUERY, QUERY.indexOf("10")],
    [QUERY, QUERY.indexOf(",")],
    ["", 0],
    [QUERY, QUERY.length + 50],
  ])("no hover at %#", (text, offset) => {
    expect(hoverScoutQl(text, offset)).toBeUndefined();
  });

  test("an unknown identifier has no documentation", () => {
    expect(
      hoverScoutQl(
        "SELECT COUNT(*) AS games FROM match_participants WHERE nonsense = 1",
        "SELECT COUNT(*) AS games FROM match_participants WHERE non".length,
      ),
    ).toBeUndefined();
  });

  test("the hovered span covers the whole token", () => {
    const index = QUERY.indexOf("win_rate");
    const hover = hoverScoutQl(QUERY, index + 2);
    expect(hover?.span).toEqual({ start: index, end: index + 8 });
  });
});
