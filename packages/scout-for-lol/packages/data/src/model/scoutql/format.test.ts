import { describe, expect, test } from "vitest";
import { analyzeScoutQl } from "#src/model/scoutql/analyze.ts";
import { compileScoutQl } from "#src/model/scoutql/compile.ts";
import { formatScoutQl } from "#src/model/scoutql/format.ts";
import { SCOUTQL_IDIOMS } from "#src/model/scoutql/scoutql-idioms.ts";
import { SCOUTQL_PRESETS } from "#src/model/scoutql/presets.ts";

// ── The canonical printer ────────────────────────────────────────────────────
// Two properties carry the formatter, and both are checked against the plan
// rather than against the text: a format that changes the compiled plan has
// changed the question, and a format that is not a fixed point would make the
// Format button produce a diff every time it is pressed.

const BOUND = "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY";

const CORPUS: string[] = [
  ...SCOUTQL_PRESETS.map((preset) => preset.query),
  ...SCOUTQL_IDIOMS.map((idiom) => idiom.query),
];

/** Queries written the way a person actually types them. */
const MESSY: string[] = [
  `select count(*) as games from match_participants where ${BOUND} group by player`,
  `SELECT   COUNT(*)   AS games\n\n FROM match_participants   WHERE ${BOUND}   GROUP BY player`,
  `SELECT COUNT(*) AS games FROM match_participants WHERE ((queue = 'solo')) AND (${BOUND}) GROUP BY player`,
  `SELECT COUNT(*) AS games FROM match_participants WHERE (queue = 'solo' OR queue = 'flex') AND NOT surrendered AND ${BOUND} GROUP BY player`,
  `SELECT SUM(CAST(win AS INT)) AS wins, COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY player`,
  `SELECT COUNT(*) AS games FROM match_participants WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL '30 days' GROUP BY player`,
  `SELECT COUNT(*) AS games FROM match_participants WHERE champion_name LIKE 'Ka%' AND champion_name IS NOT NULL AND ${BOUND} GROUP BY champion`,
  `SELECT SUM(kills) - SUM(deaths) AS net, COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY player ORDER BY net DESC, games`,
  `-- a header\nSELECT COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY player -- trailing`,
];

describe("formatting preserves meaning", () => {
  for (const query of [...CORPUS, ...MESSY]) {
    test(query.slice(0, 56), () => {
      const formatted = formatScoutQl(query);
      expect(
        analyzeScoutQl(formatted).diagnostics.filter(
          (diagnostic) => diagnostic.severity === "error",
        ),
      ).toEqual([]);
      expect(compileScoutQl(formatted)).toEqual(compileScoutQl(query));
    });
  }
});

describe("formatting is idempotent", () => {
  for (const query of [...CORPUS, ...MESSY]) {
    test(query.slice(0, 56), () => {
      const once = formatScoutQl(query);
      expect(formatScoutQl(once)).toBe(once);
    });
  }
});

describe("canonical output", () => {
  test("one clause per line, keywords up, columns down", () => {
    expect(
      formatScoutQl(
        `select count(*) as games, avg(win::int) as win_rate from match_participants where queue in ('solo') and ${BOUND} group by player having games >= 10 order by win_rate desc limit 10 render bar_chart with (y = win_rate)`,
      ),
    ).toBe(
      `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
WHERE queue IN ('solo')
  AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY player
HAVING games >= 10
ORDER BY win_rate DESC
LIMIT 10
RENDER bar_chart WITH (y = win_rate)`,
    );
  });

  test("redundant parentheses go, meaningful ones stay", () => {
    const formatted = formatScoutQl(
      `SELECT COUNT(*) AS games FROM match_participants WHERE ((queue = 'solo')) AND (queue = 'flex' OR surrendered) AND ${BOUND} GROUP BY player`,
    );
    expect(formatted).toContain("WHERE queue = 'solo'");
    expect(formatted).toContain("AND (queue = 'flex' OR surrendered)");
  });

  test("comments keep their place across a reflow", () => {
    expect(
      formatScoutQl(
        `-- how active is everyone?\nSELECT COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY player -- by player`,
      ),
    ).toBe(
      `-- how active is everyone?
SELECT COUNT(*) AS games
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY player
-- by player`,
    );
  });

  test("cast and interval surface forms survive", () => {
    const formatted = formatScoutQl(
      `SELECT SUM(CAST(win AS INT)) AS wins FROM match_participants WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL '30 days' GROUP BY player`,
    );
    expect(formatted).toContain("SUM(CAST(win AS INT)) AS wins");
    expect(formatted).toContain("INTERVAL '30 days'");
  });

  test("render option values that spell keywords survive a round trip", () => {
    // `sort = desc` and `smooth = true` lex as keywords but are values here.
    const query = `SELECT COUNT(*) AS games
FROM match_participants
WHERE ${BOUND}
GROUP BY player
RENDER bar_chart WITH (y = games, sort = desc, smooth = true)`;
    expect(formatScoutQl(query)).toBe(query);
    expect(compileScoutQl(query).render).toEqual(
      compileScoutQl(formatScoutQl(query)).render,
    );
  });

  test("every preset and idiom is already canonical", () => {
    for (const query of CORPUS) {
      expect(formatScoutQl(query)).toBe(query);
    }
  });
});

describe("a broken query is never rewritten", () => {
  test.each([
    ["", "empty"],
    ["SELECT", "just a keyword"],
    ["SELECT COUNT(*) AS games FROM", "no source"],
    ["SELECT COUNT(*) FROM match_participants WHERE (", "unclosed paren"],
    [
      "SELECT AVG(win) AS r FROM match_participants GROUP BY player",
      "type error",
    ],
    ["SELECT COUNT(*) AS g FROM nope GROUP BY player", "unknown source"],
    [
      'SELECT COUNT(*) AS g FROM match_participants WHERE queue = "solo"',
      "double quotes",
    ],
    ["SELECT CASE FROM match_participants", "CASE"],
  ])("%s (%s) comes back unchanged", (query) => {
    expect(formatScoutQl(query)).toBe(query);
  });

  test("a warning is not an error — an unbounded query still formats", () => {
    expect(
      formatScoutQl(
        "select count(*) as games from match_participants group by player",
      ),
    ).toBe(
      "SELECT COUNT(*) AS games\nFROM match_participants\nGROUP BY player",
    );
  });
});
