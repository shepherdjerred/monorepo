import { describe, expect, test } from "vitest";
import { lintScoutQl } from "#src/model/scoutql/lint.ts";
import {
  applyReportTimeSpec,
  readReportTimeSpec,
  type ReportTimeSpec,
} from "#src/model/scoutql/report-time-spec.ts";
import { SCOUTQL_IDIOMS } from "#src/model/scoutql/scoutql-idioms.ts";
import { SCOUTQL_PRESETS } from "#src/model/scoutql/presets.ts";

// ── Time controls ────────────────────────────────────────────────────────────
// These functions are the whole contract between the app's period / bucket /
// compare controls and the query text. The properties that matter are that
// reading then applying changes nothing, and that changing one facet leaves
// every other character alone.

const WEEKLY = `SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) AS games
FROM match_participants
WHERE queue IN ('solo')
  AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY week ASC
RENDER line_chart WITH (y = games)`;

const FLAT = `SELECT COUNT(*) AS games
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY player
ORDER BY games DESC`;

const CORPUS: string[] = [
  ...SCOUTQL_PRESETS.map((preset) => preset.query),
  ...SCOUTQL_IDIOMS.map((idiom) => idiom.query),
  WEEKLY,
  FLAT,
];

function specOf(text: string): ReportTimeSpec {
  const spec = readReportTimeSpec(text);
  expect(spec).toBeDefined();
  if (spec === undefined) {
    throw new Error("unreachable");
  }
  return spec;
}

function withFacet(text: string, patch: Partial<ReportTimeSpec>): string {
  return applyReportTimeSpec(text, { ...specOf(text), ...patch });
}

describe("reading", () => {
  test("a bucketed, bounded query", () => {
    expect(specOf(WEEKLY)).toEqual({
      window: { kind: "relative", days: 90 },
      bucket: "week",
      compare: false,
      timezone: "UTC",
    });
  });

  test("weeks and months are reported in days", () => {
    expect(
      specOf(
        "SELECT COUNT(*) AS games FROM match_participants WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 3 WEEK GROUP BY player",
      ).window,
    ).toEqual({ kind: "relative", days: 21 });
  });

  test("a calendar window carries its zone", () => {
    expect(
      specOf(
        "SELECT COUNT(*) AS games FROM match_participants WHERE (game_creation_at AT TIME ZONE 'America/Los_Angeles')::DATE BETWEEN '2026-01-01' AND '2026-01-31' GROUP BY player",
      ),
    ).toEqual({
      window: {
        kind: "calendar",
        start: "2026-01-01",
        end: "2026-01-31",
        timezone: "America/Los_Angeles",
      },
      bucket: null,
      compare: false,
      timezone: "America/Los_Angeles",
    });
  });

  test("no time bound reads as all history", () => {
    expect(
      specOf("SELECT COUNT(*) AS games FROM match_participants GROUP BY player")
        .window,
    ).toEqual({ kind: "all-history" });
  });

  test("the patch dimension is a bucket", () => {
    expect(
      specOf(
        `SELECT patch, COUNT(*) AS games FROM match_participants WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY GROUP BY patch`,
      ).bucket,
    ).toBe("patch");
  });

  test("compare is read from the render clause", () => {
    expect(
      specOf(
        WEEKLY.replace("(y = games)", "(y = games, compare = previous_period)"),
      ).compare,
    ).toBe(true);
  });

  test.each([
    [
      "a hand-written time filter",
      "SELECT COUNT(*) AS games FROM match_participants WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 6 HOUR GROUP BY player",
    ],
    [
      "a snapshot source",
      "SELECT player, MIN(rank) AS best FROM rank_current GROUP BY player",
    ],
    ["a broken query", "SELECT AVG(win) AS r FROM match_participants"],
    ["nothing at all", ""],
  ])("%s has no controls", (_label, query) => {
    expect(readReportTimeSpec(query)).toBeUndefined();
    expect(
      applyReportTimeSpec(query, {
        window: { kind: "relative", days: 7 },
        bucket: null,
        compare: false,
        timezone: "UTC",
      }),
    ).toBe(query);
  });
});

describe("applying what was read changes nothing", () => {
  for (const query of CORPUS) {
    test(query.slice(0, 48), () => {
      const spec = readReportTimeSpec(query);
      if (spec === undefined) {
        return;
      }
      expect(applyReportTimeSpec(query, spec)).toBe(query);
    });
  }
});

describe("the window facet", () => {
  test("a different period edits only the interval", () => {
    expect(withFacet(WEEKLY, { window: { kind: "relative", days: 30 } })).toBe(
      WEEKLY.replace("INTERVAL 90 DAY", "INTERVAL 30 DAY"),
    );
  });

  test("switching to a calendar range replaces the conjunct in place", () => {
    expect(
      withFacet(WEEKLY, {
        window: {
          kind: "calendar",
          start: "2026-01-01",
          end: "2026-01-31",
          timezone: "UTC",
        },
      }),
    ).toBe(
      WEEKLY.replace(
        "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY",
        "game_creation_at::DATE BETWEEN '2026-01-01' AND '2026-01-31'",
      ),
    );
  });

  test("all history removes the conjunct and its AND", () => {
    expect(withFacet(WEEKLY, { window: { kind: "all-history" } })).toBe(
      WEEKLY.replace(
        "\n  AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY",
        "",
      ),
    );
  });

  test("all history on a lone conjunct removes the whole WHERE", () => {
    expect(withFacet(FLAT, { window: { kind: "all-history" } })).toBe(
      FLAT.replace(
        "\nWHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY",
        "",
      ),
    );
  });

  test("bounding an unbounded query adds the clause back", () => {
    const unbounded = FLAT.replace(
      "\nWHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY",
      "",
    );
    expect(
      withFacet(unbounded, { window: { kind: "relative", days: 14 } }),
    ).toBe(FLAT.replace("INTERVAL 30 DAY", "INTERVAL 14 DAY"));
  });

  test("an existing WHERE gains a conjunct rather than losing its filter", () => {
    const query =
      "SELECT COUNT(*) AS games FROM match_participants WHERE queue = 'solo' GROUP BY player";
    expect(withFacet(query, { window: { kind: "relative", days: 7 } })).toBe(
      "SELECT COUNT(*) AS games FROM match_participants WHERE queue = 'solo' AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 7 DAY GROUP BY player",
    );
  });

  test("a top-level OR is parenthesized before the AND is appended", () => {
    const query =
      "SELECT COUNT(*) AS games FROM match_participants WHERE queue = 'solo' OR queue = 'flex' GROUP BY player";
    expect(withFacet(query, { window: { kind: "relative", days: 7 } })).toBe(
      "SELECT COUNT(*) AS games FROM match_participants WHERE (queue = 'solo' OR queue = 'flex') AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 7 DAY GROUP BY player",
    );
  });
});

describe("the bucket facet", () => {
  test("a different part rewrites every mention and the derived name", () => {
    expect(withFacet(WEEKLY, { bucket: "month" })).toBe(
      WEEKLY.replaceAll("'week'", "'month'").replaceAll(/\bweek\b/gu, "month"),
    );
  });

  test("switching to patch replaces the term and drops the redundant alias", () => {
    expect(withFacet(WEEKLY, { bucket: "patch" })).toBe(
      `SELECT patch, COUNT(*) AS games
FROM match_participants
WHERE queue IN ('solo')
  AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY
GROUP BY patch
ORDER BY patch ASC
RENDER line_chart WITH (y = games)`,
    );
  });

  test("switching from patch back to a calendar bucket names the output", () => {
    const patched = withFacet(WEEKLY, { bucket: "patch" });
    expect(
      applyReportTimeSpec(patched, { ...specOf(patched), bucket: "day" }),
    ).toBe(
      WEEKLY.replaceAll("'week'", "'day'").replaceAll(/\bweek\b/gu, "day"),
    );
  });

  test("a time zone moves the bucket boundaries", () => {
    expect(withFacet(WEEKLY, { timezone: "America/Los_Angeles" })).toBe(
      WEEKLY.replaceAll(
        "DATE_TRUNC('week', game_creation_at)",
        "DATE_TRUNC('week', game_creation_at AT TIME ZONE 'America/Los_Angeles')",
      ),
    );
  });

  test("removing the bucket removes its output, grouping, and sort key", () => {
    expect(withFacet(WEEKLY, { bucket: null })).toBe(
      `SELECT COUNT(*) AS games
FROM match_participants
WHERE queue IN ('solo')
  AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY
RENDER line_chart WITH (y = games)`,
    );
  });

  test("adding a bucket to a flat query adds both halves", () => {
    expect(withFacet(FLAT, { bucket: "day" })).toBe(
      `SELECT DATE_TRUNC('day', game_creation_at) AS day, COUNT(*) AS games
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY DATE_TRUNC('day', game_creation_at), player
ORDER BY games DESC`,
    );
  });

  test("a hand-chosen alias survives a bucket change", () => {
    const query = `SELECT DATE_TRUNC('week', game_creation_at) AS bucket, COUNT(*) AS games
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY bucket ASC`;
    expect(withFacet(query, { bucket: "month" })).toBe(
      query.replaceAll("'week'", "'month'"),
    );
  });
});

describe("the compare facet", () => {
  test("enabling appends the option to an existing WITH list", () => {
    expect(withFacet(WEEKLY, { compare: true })).toBe(
      WEEKLY.replace("(y = games)", "(y = games, compare = previous_period)"),
    );
  });

  test("disabling removes only that option", () => {
    const comparing = withFacet(WEEKLY, { compare: true });
    expect(
      applyReportTimeSpec(comparing, {
        ...specOf(comparing),
        compare: false,
      }),
    ).toBe(WEEKLY);
  });

  test("disabling the only option removes the whole WITH clause", () => {
    const query = WEEKLY.replace(
      "WITH (y = games)",
      "WITH (compare = previous_period)",
    );
    expect(withFacet(query, { compare: false })).toBe(
      query.replace(" WITH (compare = previous_period)", ""),
    );
  });

  test("enabling on a query with no RENDER clause adds a chart to carry it", () => {
    const query = `SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) AS games
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY DATE_TRUNC('week', game_creation_at)`;
    expect(withFacet(query, { compare: true })).toBe(
      `${query} RENDER line_chart WITH (compare = previous_period)`,
    );
  });
});

describe("round trips and isolation", () => {
  const SPECS: ReportTimeSpec[] = [
    {
      window: { kind: "relative", days: 7 },
      bucket: "day",
      compare: false,
      timezone: "UTC",
    },
    {
      window: { kind: "relative", days: 90 },
      bucket: "week",
      compare: true,
      timezone: "UTC",
    },
    {
      window: { kind: "relative", days: 30 },
      bucket: "month",
      compare: false,
      timezone: "America/Los_Angeles",
    },
    {
      window: { kind: "relative", days: 60 },
      bucket: "patch",
      compare: true,
      timezone: "UTC",
    },
    {
      window: {
        kind: "calendar",
        start: "2026-01-01",
        end: "2026-03-31",
        timezone: "Europe/Berlin",
      },
      bucket: "week",
      compare: true,
      timezone: "Europe/Berlin",
    },
    {
      window: { kind: "all-history" },
      bucket: "week",
      compare: false,
      timezone: "UTC",
    },
  ];

  for (const [index, spec] of SPECS.entries()) {
    test(`spec ${String(index)} survives a read after apply`, () => {
      const applied = applyReportTimeSpec(WEEKLY, spec);
      expect(readReportTimeSpec(applied)).toEqual(spec);
      expect(
        lintScoutQl(applied).filter(
          (diagnostic) => diagnostic.severity === "error",
        ),
      ).toEqual([]);
    });
  }

  test("unrelated clauses and comments are untouched", () => {
    const query = `-- activity by week
SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) FILTER (WHERE win) AS wins
FROM match_participants
WHERE queue IN ('solo', 'flex')
  AND champion_id = champion('Jinx')
  AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY
GROUP BY DATE_TRUNC('week', game_creation_at)
HAVING wins >= 1
ORDER BY week ASC
LIMIT 20
RENDER bar_chart WITH (y = wins, palette = team) -- team colours`;
    const applied = withFacet(query, { window: { kind: "relative", days: 7 } });
    expect(applied).toBe(query.replace("INTERVAL 90 DAY", "INTERVAL 7 DAY"));
    expect(applied).toContain("-- activity by week");
    expect(applied).toContain("-- team colours");
  });

  test("every corpus query survives every facet toggle", () => {
    for (const query of CORPUS) {
      const spec = readReportTimeSpec(query);
      if (spec === undefined) {
        continue;
      }
      const toggled = applyReportTimeSpec(query, {
        ...spec,
        window: { kind: "relative", days: 45 },
      });
      expect(
        lintScoutQl(toggled).filter(
          (diagnostic) => diagnostic.severity === "error",
        ),
      ).toEqual([]);
      expect(readReportTimeSpec(toggled)?.window).toEqual({
        kind: "relative",
        days: 45,
      });
    }
  });
});
