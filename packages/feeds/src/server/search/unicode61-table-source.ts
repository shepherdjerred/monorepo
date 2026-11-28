import { Database } from "bun:sqlite";

/**
 * The FTS5 `unicode61` tokenizer's per-code-point behaviour, read from SQLite
 * itself: which code points are token characters, which of those it drops,
 * and what the rest fold to. `search-tokens.ts` tokenizes from the committed
 * copy (`unicode61-table.json`); `bun run generate:unicode61` rewrites it and
 * `search-tokens.test.ts` fails if it no longer matches SQLite.
 */
export type Unicode61Table = {
  /** Inclusive token-character ranges, `start-end` or `cp`, hex, comma separated. */
  readonly tokenRanges: string;
  /** Token characters unicode61 drops (combining diacritics), hex, comma separated. */
  readonly dropped: string;
  /** `from:to` folds for token characters that do not fold to themselves. */
  readonly folds: string;
};

const MAX_CODE_POINT = 0x10_ff_ff;

function isSurrogate(cp: number): boolean {
  return cp >= 0xd8_00 && cp <= 0xdf_ff;
}

function hex(cp: number): string {
  return cp.toString(16);
}

type Probe = { readonly term: string; readonly doc: number };

/** Tokenizes `q<cp>z` for every scalar value with unicode61. */
function probeEveryCodePoint(): Map<number, string[]> {
  const db = new Database(":memory:");
  try {
    db.run("CREATE VIRTUAL TABLE probe USING fts5(t, tokenize='unicode61')");
    db.run("CREATE VIRTUAL TABLE probe_terms USING fts5vocab(probe, instance)");
    const insert = db.query("INSERT INTO probe (rowid, t) VALUES (?, ?)");
    db.transaction(() => {
      for (let cp = 0; cp <= MAX_CODE_POINT; cp += 1) {
        if (!isSurrogate(cp)) {
          insert.run(cp + 1, `q${String.fromCodePoint(cp)}z`);
        }
      }
    })();
    const rows = db
      .query<Probe, []>(
        "SELECT term, doc FROM probe_terms ORDER BY doc, offset",
      )
      .all();
    const byCodePoint = new Map<number, string[]>();
    for (const row of rows) {
      const cp = row.doc - 1;
      const terms = byCodePoint.get(cp) ?? [];
      terms.push(row.term);
      byCodePoint.set(cp, terms);
    }
    return byCodePoint;
  } finally {
    db.close();
  }
}

type Classified =
  | { readonly kind: "separator" }
  | { readonly kind: "dropped" }
  | { readonly kind: "token"; readonly folded: string };

function classify(cp: number, terms: readonly string[]): Classified {
  if (terms.length === 2 && terms[0] === "q" && terms[1] === "z") {
    return { kind: "separator" };
  }
  const single = terms.length === 1 ? terms[0] : undefined;
  if (single?.startsWith("q") === true && single.endsWith("z")) {
    const folded = single.slice(1, -1);
    return folded === "" ? { kind: "dropped" } : { kind: "token", folded };
  }
  throw new Error(
    `unicode61 tokenized U+${hex(cp)} unexpectedly: ${JSON.stringify(terms)}`,
  );
}

/** Reads the table from the SQLite build Bun ships. */
export function readUnicode61Table(): Unicode61Table {
  const probes = probeEveryCodePoint();
  const ranges: string[] = [];
  const dropped: string[] = [];
  const folds: string[] = [];
  let rangeStart: number | undefined;
  const closeRange = (end: number): void => {
    if (rangeStart === undefined) return;
    ranges.push(
      rangeStart === end ? hex(rangeStart) : `${hex(rangeStart)}-${hex(end)}`,
    );
    rangeStart = undefined;
  };
  for (let cp = 0; cp <= MAX_CODE_POINT; cp += 1) {
    const entry = isSurrogate(cp)
      ? ({ kind: "separator" } as const)
      : classify(cp, probes.get(cp) ?? []);
    if (entry.kind === "separator") {
      closeRange(cp - 1);
      continue;
    }
    rangeStart ??= cp;
    if (entry.kind === "dropped") {
      dropped.push(hex(cp));
    } else if (entry.folded !== String.fromCodePoint(cp)) {
      const target = entry.folded.codePointAt(0);
      if (
        target === undefined ||
        String.fromCodePoint(target) !== entry.folded
      ) {
        throw new Error(`unicode61 folds U+${hex(cp)} to several characters`);
      }
      folds.push(`${hex(cp)}:${hex(target)}`);
    }
  }
  closeRange(MAX_CODE_POINT);
  return {
    tokenRanges: ranges.join(","),
    dropped: dropped.join(","),
    folds: folds.join(","),
  };
}
