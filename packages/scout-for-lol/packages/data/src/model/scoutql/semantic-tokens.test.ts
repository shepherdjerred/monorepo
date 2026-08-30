import { describe, expect, test } from "vitest";
import {
  scoutQlSemanticTokens,
  scoutQlTokenSpans,
  type ScoutQlTokenKind,
} from "#src/model/scoutql/semantic-tokens.ts";
import { SCOUTQL_IDIOMS } from "#src/model/scoutql/scoutql-idioms.ts";
import { SCOUTQL_PRESETS } from "#src/model/scoutql/presets.ts";

// ── Semantic tokens ──────────────────────────────────────────────────────────
// The load-bearing property is losslessness: every surface renders a query by
// emitting these spans and nothing else, so a dropped character is a silently
// corrupted query on screen.

const CORPUS: string[] = [
  ...SCOUTQL_PRESETS.map((preset) => preset.query),
  ...SCOUTQL_IDIOMS.map((idiom) => idiom.query),
];

/** Kind of the first span whose text matches, for readable assertions. */
function kindOf(text: string, lexeme: string): ScoutQlTokenKind | undefined {
  return scoutQlTokenSpans(text).find((span) => span.text === lexeme)?.kind;
}

function kindsOf(text: string, lexeme: string): ScoutQlTokenKind[] {
  return scoutQlTokenSpans(text)
    .filter((span) => span.text === lexeme)
    .map((span) => span.kind);
}

describe("token spans reproduce the source byte for byte", () => {
  for (const query of CORPUS) {
    test(query.slice(0, 48), () => {
      expect(
        scoutQlTokenSpans(query)
          .map((span) => span.text)
          .join(""),
      ).toBe(query);
    });
  }

  test("the positioned variant tiles the input without gaps or overlap", () => {
    const [query] = CORPUS;
    expect(query).toBeDefined();
    const tokens = scoutQlSemanticTokens(query ?? "");
    let cursor = 0;
    for (const token of tokens) {
      expect(token.start).toBe(cursor);
      expect(token.length).toBeGreaterThan(0);
      cursor = token.start + token.length;
    }
    expect(cursor).toBe((query ?? "").length);
  });

  test("an empty query yields no spans", () => {
    expect(scoutQlTokenSpans("")).toEqual([]);
  });
});

// ── Fuzz: malformed input must still round-trip ──────────────────────────────

/** Deterministic PRNG so a failing case is reproducible from the seed. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const MUTATION_CHARS: string[] = [
  "'",
  '"',
  "(",
  ")",
  "@",
  "#",
  "$",
  ",",
  ".",
  ";",
  ":",
  "*",
  "/",
  "-",
  "\n",
  "\t",
  " ",
  "\\",
  "|",
  "`",
  "~",
  "<",
  ">",
  "=",
  "!",
];

function mutate(text: string, random: () => number): string {
  const cut = Math.floor(random() * text.length);
  const choice = Math.floor(random() * 4);
  if (choice === 0) {
    return text.slice(0, cut);
  }
  if (choice === 1) {
    return text.slice(cut);
  }
  const char =
    MUTATION_CHARS[Math.floor(random() * MUTATION_CHARS.length)] ?? "@";
  if (choice === 2) {
    return text.slice(0, cut) + char + text.slice(cut);
  }
  return text.slice(0, cut) + char + text.slice(cut + 1);
}

describe("malformed input", () => {
  test(
    "2000 mutations of the corpus still reproduce their source",
    { timeout: 15_000 },
    () => {
      const random = makeRandom(20_260_823);
      for (let index = 0; index < 2000; index++) {
        const base = CORPUS[Math.floor(random() * CORPUS.length)] ?? "";
        const mutated = mutate(base, random);
        const spans = scoutQlTokenSpans(mutated);
        expect(spans.map((span) => span.text).join("")).toBe(mutated);
      }
    },
  );

  test("characters no rule matches are invalid, whitespace stays plain", () => {
    const spans = scoutQlTokenSpans("SELECT @ ~ FROM x");
    expect(spans.map((span) => span.text).join("")).toBe("SELECT @ ~ FROM x");
    expect(kindOf("SELECT @ ~ FROM x", "@")).toBe("invalid");
    expect(kindOf("SELECT @ ~ FROM x", " ")).toBe("plain");
  });

  test("an unterminated string is invalid, not string", () => {
    expect(kindOf("SELECT COUNT(*) FROM x WHERE queue = 'solo", "'solo")).toBe(
      "invalid",
    );
  });

  test("a double-quoted identifier is invalid — ScoutQL strings use ''", () => {
    expect(kindOf('SELECT "games" FROM x', '"games"')).toBe("invalid");
  });
});

// ── Semantic upgrades ────────────────────────────────────────────────────────

describe("identifiers are upgraded through the analysis", () => {
  const query =
    "-- weekly\n" +
    "SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate, per_minute(creep_score) AS cs\n" +
    "FROM match_participants\n" +
    "WHERE queue IN ('solo')\n" +
    "  AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY\n" +
    "GROUP BY player\n" +
    "HAVING games >= 10\n" +
    "ORDER BY win_rate DESC\n" +
    "RENDER bar_chart WITH (y = win_rate, palette = gold)";

  test.each([
    ["SELECT", "keyword"],
    ["COUNT", "aggregate"],
    ["AVG", "aggregate"],
    ["per_minute", "aggregate"],
    ["match_participants", "source"],
    ["win", "column"],
    ["creep_score", "column"],
    ["player", "column"],
    ["queue", "column"],
    ["bar_chart", "renderKind"],
    ["palette", "renderOption"],
    ["gold", "plain"],
    ["'solo'", "string"],
    ["30", "number"],
    [">=", "operator"],
    ["-- weekly", "comment"],
  ])("%s is %s", (lexeme, kind) => {
    expect(kindOf(query, lexeme)).toBe(kind);
  });

  test("an alias is an alias at every mention", () => {
    // Declaration (AS win_rate), ORDER BY reference, and RENDER channel.
    expect(kindsOf(query, "win_rate")).toEqual(["alias", "alias", "alias"]);
  });

  test("a HAVING reference to an output is an alias, not a column", () => {
    expect(kindsOf(query, "games")).toEqual(["alias", "alias"]);
  });

  test("an unknown source still highlights as a source", () => {
    expect(kindOf("SELECT COUNT(*) FROM nope", "nope")).toBe("source");
  });

  test("a column of a different source is not upgraded", () => {
    // `score` belongs to rank_current, not match_participants.
    expect(
      kindOf("SELECT MAX(score) AS s FROM match_participants", "score"),
    ).toBe("plain");
  });

  test("render option names and values are distinguished at depth", () => {
    const nested =
      "SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate FROM match_participants " +
      "GROUP BY player RENDER bar_chart WITH (format = (win_rate = percent))";
    expect(kindOf(nested, "format")).toBe("renderOption");
    expect(kindsOf(nested, "win_rate")).toEqual(["alias", "alias"]);
    expect(kindOf(nested, "percent")).toBe("plain");
  });

  test("CASE lexes as a keyword even though it is rejected", () => {
    expect(kindOf("SELECT CASE FROM match_participants", "CASE")).toBe(
      "keyword",
    );
  });
});
