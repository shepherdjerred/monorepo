import { Database } from "bun:sqlite";
import { describe, expect, test } from "vitest";
import {
  entrySearchDocument,
  parseSearchQuery,
  searchTokens,
} from "./search-tokens.ts";
import committedTable from "./unicode61-table.json" with { type: "json" };
import { readUnicode61Table } from "./unicode61-table-source.ts";

/** Titles that exercise unicode61's folding and separators together. */
const TOKENIZER_CORPUS: readonly string[] = [
  "Hello, World!",
  "café naïve résumé",
  "ệ ầ Ữ two diacritics stay",
  "foo_bar baz-qux",
  "C++ & C# v1.2.3 release",
  "İstanbul ẞtraße Straße",
  "日本語のテキスト",
  "Привет мир й",
  "ﬁle ligature ＦＵＬＬ width",
  "x́y combining è́",
  "emoji 🚀 test ✅",
  "Ǆ dz ǅungla ǈ ǉ",
  "²³ ½ Ⅻ",
  "pua",
  "ΟΔΟΣ ς Σ Ωμέγα",
  "K Kelvin µ ſ",
  "don’t a'b",
  "Ångström Øresund Łódź",
  "ด้วย Thai हिन्दी",
  "́ lone diacritic",
  "Ꭰ cherokee ꭰ",
];

function fts5Tokens(texts: readonly string[]): string[][] {
  const db = new Database(":memory:");
  try {
    db.run("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='unicode61')");
    db.run("CREATE VIRTUAL TABLE v USING fts5vocab(t, instance)");
    const insert = db.query("INSERT INTO t (rowid, x) VALUES (?, ?)");
    texts.forEach((text, index) => insert.run(index + 1, text));
    const rows = db
      .query<{ readonly term: string; readonly doc: number }, []>(
        "SELECT term, doc FROM v ORDER BY doc, offset",
      )
      .all();
    return texts.map((_text, index) =>
      rows.filter((row) => row.doc === index + 1).map((row) => row.term),
    );
  } finally {
    db.close();
  }
}

describe("unicode61-compatible search tokens", () => {
  test("the committed table matches SQLite's unicode61 for every code point", () => {
    expect(readUnicode61Table()).toEqual(committedTable);
  });

  test("tokenizes like FTS5 unicode61 across scripts, folds, and separators", () => {
    const expected = fts5Tokens(TOKENIZER_CORPUS);
    expect(TOKENIZER_CORPUS.map((text) => searchTokens(text))).toEqual(
      expected,
    );
    expect(searchTokens("Café, NAÏVE")).toEqual(["cafe", "naive"]);
  });

  test("builds tsvector literals with a gap between title and author", () => {
    expect(entrySearchDocument("Hello hello World", "Jane Doe")).toBe(
      "'hello':1,2 'world':3 'jane':5 'doe':6",
    );
    expect(entrySearchDocument("", "")).toBe("");
    expect(entrySearchDocument("x".repeat(3000), "ok")).toBe("'ok':3");
  });

  test("parses console search the way the FTS5 sanitizer did", () => {
    expect(parseSearchQuery("   ")).toEqual({ kind: "none" });
    expect(parseSearchQuery("+++ ???")).toEqual({ kind: "nothing" });
    expect(parseSearchQuery('"" "!!"')).toEqual({ kind: "nothing" });
    expect(parseSearchQuery("AI SDK")).toEqual({
      kind: "match",
      tsquery: "'ai':* & 'sdk':*",
    });
    expect(parseSearchQuery("v1.4.2")).toEqual({
      kind: "match",
      tsquery: "'v1':* & '4':* & '2':*",
    });
    expect(parseSearchQuery('"exact phrase" foo_bar')).toEqual({
      kind: "match",
      tsquery: "('exact' <-> 'phrase') & ('foo' <-> 'bar':*)",
    });
    expect(parseSearchQuery('"exact')).toEqual({
      kind: "match",
      tsquery: "'exact':*",
    });
    expect(parseSearchQuery("_ résumé")).toEqual({
      kind: "match",
      tsquery: "'resume':*",
    });
  });
});
