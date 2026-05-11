import { z } from "zod/v4";
import type { SymbolEntry, SymbolIndex } from "./symbol-index.ts";

/**
 * Hybrid retrieval over the symbol index for the PR review pipeline.
 *
 * Combines:
 *  - Lexical: identifier tokens extracted from changed-line text, looked up
 *    against `SymbolIndex.byName`. Ranks by hit count.
 *  - Semantic: `toolkit recall search` subprocess over a one-line diff
 *    summary. Returns scored chunks; we map result paths back to the symbol
 *    index when possible.
 *
 * The two ranked runs are fused via Reciprocal Rank Fusion (RRF, k=60 — the
 * standard constant from the original RRF paper). Per the RARe paper
 * (arxiv 2511.05302), top-1 retrieval beats top-K; default `k=1`.
 */

/** Score from a single ranked run, before fusion. */
type RankedHit = {
  entry: SymbolEntry;
  rank: number; // 1-indexed; lower is better
};

export type RetrievalSource = "lexical" | "semantic" | "fused";

export type RetrievedSymbol = {
  entry: SymbolEntry;
  /** RRF score (higher is better). */
  score: number;
  /** Which run(s) produced this hit, for debugging / OTel attributes. */
  sources: readonly RetrievalSource[];
};

/**
 * Schema for one row of `toolkit recall search --json` output. Matches the
 * `SearchResult` type in `packages/toolkit/src/lib/recall/search.ts`.
 */
const RecallSearchResultSchema = z.object({
  path: z.string(),
  title: z.string(),
  chunk: z.string(),
  score: z.number(),
  source: z.string(),
  chunkIndex: z.number().int().nonnegative(),
});
type RecallSearchResult = z.infer<typeof RecallSearchResultSchema>;
const RecallSearchResultsSchema = z.array(RecallSearchResultSchema);

/**
 * Stop-word list for the lexical pass. Tree-sitter could give us proper
 * identifier extraction by re-parsing the diff with each language, but
 * regex + stoplist is cheap and good enough for v1: we only care about
 * tokens that could plausibly match an exported symbol name.
 */
const LEXICAL_STOPWORDS = new Set([
  "if",
  "else",
  "for",
  "while",
  "do",
  "return",
  "break",
  "continue",
  "switch",
  "case",
  "default",
  "throw",
  "try",
  "catch",
  "finally",
  "var",
  "let",
  "const",
  "function",
  "class",
  "extends",
  "implements",
  "interface",
  "type",
  "enum",
  "struct",
  "trait",
  "impl",
  "fn",
  "pub",
  "mod",
  "use",
  "import",
  "export",
  "from",
  "as",
  "in",
  "of",
  "is",
  "this",
  "self",
  "super",
  "new",
  "null",
  "undefined",
  "true",
  "false",
  "void",
  "async",
  "await",
  "yield",
  "static",
  "public",
  "private",
  "protected",
  "package",
  "go",
  "string",
  "number",
  "boolean",
  "int",
  "long",
  "float",
  "double",
  "any",
  "unknown",
  "never",
]);

const MIN_TOKEN_LENGTH = 3;
const IDENTIFIER_RE = /[A-Z_]\w+/gi;
const DIFF_LINE_RE = /^[+-][^+-].*$/gm;

/**
 * Pull a set of identifier-like tokens out of a unified diff. Only looks at
 * `+` and `-` lines (i.e. the lines that changed) — context lines are
 * intentionally skipped so we don't drown the signal with unchanged code.
 */
export function extractIdentifiersFromDiff(diff: string): Set<string> {
  const tokens = new Set<string>();
  const matches = diff.match(DIFF_LINE_RE) ?? [];
  for (const line of matches) {
    // Strip the leading `+`/`-` marker before tokenizing.
    const body = line.slice(1);
    const idMatches = body.match(IDENTIFIER_RE) ?? [];
    for (const id of idMatches) {
      if (id.length < MIN_TOKEN_LENGTH) continue;
      if (LEXICAL_STOPWORDS.has(id)) continue;
      tokens.add(id);
    }
  }
  return tokens;
}

/**
 * Lexical retrieval: for every identifier in the diff, look it up in the
 * symbol index. Ranks by the number of distinct identifiers that resolve
 * to the same symbol entry (multi-occurrence is a strong signal).
 */
export function lexicalRetrieve(diff: string, index: SymbolIndex): RankedHit[] {
  const tokens = extractIdentifiersFromDiff(diff);
  // entry-key (file + line + name) → hit count.
  const hits = new Map<string, { entry: SymbolEntry; count: number }>();
  for (const token of tokens) {
    for (const entry of index.byName.get(token) ?? []) {
      const key = `${entry.file}:${String(entry.line)}:${entry.name}`;
      const existing = hits.get(key);
      if (existing === undefined) {
        hits.set(key, { entry, count: 1 });
      } else {
        existing.count += 1;
      }
    }
  }
  return [...hits.values()]
    .toSorted((a, b) => b.count - a.count)
    .map((h, i) => ({ entry: h.entry, rank: i + 1 }));
}

/**
 * Map a recall search result (`path` is an absolute or relative path,
 * possibly under `~/.recall/fetched/` or anywhere else) to a symbol-index
 * entry. Only returns when the path resolves to a file we actually
 * indexed.
 */
function mapRecallResultsToEntries(
  results: readonly RecallSearchResult[],
  index: SymbolIndex,
  repoRoot: string,
): RankedHit[] {
  const repoRootTrailing = repoRoot.endsWith("/") ? repoRoot : `${repoRoot}/`;
  const out: RankedHit[] = [];
  for (const [i, result] of results.entries()) {
    // Recall results may be absolute. Convert to repo-relative if they
    // sit under our repo root; otherwise drop them — they're not in our
    // index.
    let relPath = result.path;
    if (relPath.startsWith(repoRootTrailing)) {
      relPath = relPath.slice(repoRootTrailing.length);
    } else if (relPath.startsWith("/")) {
      continue;
    }
    const entriesInFile = index.byFile.get(relPath);
    if (entriesInFile === undefined || entriesInFile.length === 0) {
      continue;
    }
    // Take the first entry in the file as the anchor. A future iteration
    // could pick the entry closest to the result's chunk-derived line
    // number — recall doesn't expose line ranges yet.
    const firstEntry = entriesInFile[0];
    if (firstEntry === undefined) continue;
    out.push({ entry: firstEntry, rank: i + 1 });
  }
  return out;
}

/**
 * Dependency surface for the recall subprocess — overridable so tests don't
 * have to actually shell out to `toolkit`. Production uses
 * `runToolkitRecallSearch` below.
 */
export type RecallSearchFn = (
  query: string,
  limit: number,
) => Promise<RecallSearchResult[]>;

/**
 * Default implementation: shells out to `toolkit recall search <q> --json
 * --limit <n>`. Production wires this in; tests pass their own.
 */
export async function runToolkitRecallSearch(
  query: string,
  limit: number,
): Promise<RecallSearchResult[]> {
  const proc = Bun.spawn(
    ["toolkit", "recall", "search", query, "--json", "--limit", String(limit)],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    // Soft failure — the bot still works without recall, just with less
    // semantic coverage. The activity decides whether to surface this.
    return [];
  }
  const parsed = RecallSearchResultsSchema.safeParse(JSON.parse(stdout));
  return parsed.success ? parsed.data : [];
}

/**
 * Build a short, fixed-length query string from a diff for the semantic
 * search. Per the RARe paper the query quality matters more than the
 * length — we take a few of the most "interesting" identifiers (longest +
 * camelCased) as a stand-in for a natural-language summary.
 */
export function buildRecallQueryFromDiff(diff: string): string {
  const tokens = extractIdentifiersFromDiff(diff);
  return [...tokens]
    .toSorted((a, b) => {
      // Prefer longer tokens and tokens with mixed case (likely symbol-y).
      const aMixed = /[A-Z]/.test(a) && /[a-z]/.test(a);
      const bMixed = /[A-Z]/.test(b) && /[a-z]/.test(b);
      if (aMixed !== bMixed) return aMixed ? -1 : 1;
      return b.length - a.length;
    })
    .slice(0, 5)
    .join(" ");
}

const RRF_K = 60;

/**
 * Combine two ranked runs via Reciprocal Rank Fusion. Each run contributes
 * `1 / (k + rank)` to the fused score. Standard RRF — same formula the
 * toolkit's own `hybridSearch` uses internally.
 */
function reciprocalRankFusion(
  lexical: readonly RankedHit[],
  semantic: readonly RankedHit[],
): RetrievedSymbol[] {
  type Bucket = {
    entry: SymbolEntry;
    score: number;
    sources: Set<RetrievalSource>;
  };
  const buckets = new Map<string, Bucket>();

  for (const hit of lexical) {
    const key = `${hit.entry.file}:${String(hit.entry.line)}:${hit.entry.name}`;
    const score = 1 / (RRF_K + hit.rank);
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, {
        entry: hit.entry,
        score,
        sources: new Set<RetrievalSource>(["lexical"]),
      });
    } else {
      existing.score += score;
      existing.sources.add("lexical");
    }
  }

  for (const hit of semantic) {
    const key = `${hit.entry.file}:${String(hit.entry.line)}:${hit.entry.name}`;
    const score = 1 / (RRF_K + hit.rank);
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, {
        entry: hit.entry,
        score,
        sources: new Set<RetrievalSource>(["semantic"]),
      });
    } else {
      existing.score += score;
      existing.sources.add("semantic");
    }
  }

  return [...buckets.values()]
    .toSorted((a, b) => b.score - a.score)
    .map(
      (b): RetrievedSymbol => ({
        entry: b.entry,
        score: b.score,
        sources:
          b.sources.size === 2
            ? (["fused"] as const)
            : // Set<RetrievalSource> → readonly RetrievalSource[] is a safe
              // structural narrowing (Set's iterator yields its element type)
              // but TS doesn't infer that across the Array.from boundary.
              // `as unknown` is the only widening permitted by the project
              // ESLint rule; we then narrow via `Array.isArray` at the type
              // boundary in callers if they need a stricter shape.
              ([...b.sources] satisfies readonly RetrievalSource[]),
      }),
    );
}

export type HybridSearchOptions = {
  diff: string;
  index: SymbolIndex;
  /** Used to convert recall-result absolute paths to repo-relative. */
  repoRoot: string;
  /**
   * Top-K to return. Default 1 per the RARe paper — top-1 retrieval beats
   * top-K because additional context dilutes the signal.
   */
  k?: number;
  /**
   * Override the recall subprocess for tests, or skip it entirely (returns
   * lexical-only). Pass `null` to skip semantic.
   */
  recallSearch?: RecallSearchFn | null;
  /**
   * Cap on recall-result rows requested. The default (10) is roomy; we
   * actually only consume the top few after fusion.
   */
  recallLimit?: number;
};

export async function hybridSearch(
  options: HybridSearchOptions,
): Promise<RetrievedSymbol[]> {
  const { diff, index, repoRoot } = options;
  const k = options.k ?? 1;
  const recallLimit = options.recallLimit ?? 10;
  // Explicit triple-state: undefined → use the default subprocess shim;
  // null → skip semantic entirely (lexical-only); function → use that.
  // Can't use `??` because `null` is nullish and would fall through to
  // the default — `null` here is a deliberate opt-out.
  const recallSearch =
    options.recallSearch === undefined
      ? runToolkitRecallSearch
      : options.recallSearch;

  const lexicalHits = lexicalRetrieve(diff, index);

  let semanticHits: RankedHit[] = [];
  if (recallSearch !== null) {
    const query = buildRecallQueryFromDiff(diff);
    if (query.length > 0) {
      const results = await recallSearch(query, recallLimit);
      semanticHits = mapRecallResultsToEntries(results, index, repoRoot);
    }
  }

  const fused = reciprocalRankFusion(lexicalHits, semanticHits);
  return fused.slice(0, k);
}

/**
 * Format retrieved symbols into a prompt-ready block. Caller is expected to
 * wrap this in the specialist's "Related symbols and their definitions:"
 * label. Each entry includes the surrounding source snippet so the model
 * has the actual code, not just a name + location.
 */
export type FormatRetrievedOptions = {
  repoRoot: string;
  /** Lines of context above and below the symbol body. */
  contextLines?: number;
  /** Cap on lines per snippet — large functions get truncated. */
  maxSnippetLines?: number;
};

export async function formatRetrievedSymbols(
  retrieved: readonly RetrievedSymbol[],
  options: FormatRetrievedOptions,
): Promise<string> {
  if (retrieved.length === 0) {
    return "(no related symbols found)";
  }
  const ctx = options.contextLines ?? 2;
  const maxLines = options.maxSnippetLines ?? 120;
  const blocks: string[] = [];
  for (const r of retrieved) {
    const absPath = `${options.repoRoot.replace(/\/$/, "")}/${r.entry.file}`;
    let snippet = "(file unreadable)";
    try {
      const src = await Bun.file(absPath).text();
      const lines = src.split("\n");
      const startLine = Math.max(0, r.entry.line - 1 - ctx);
      const endLine = Math.min(
        lines.length,
        Math.min(r.entry.endLine + ctx, r.entry.line - 1 + maxLines),
      );
      snippet = lines.slice(startLine, endLine).join("\n");
    } catch {
      // keep the placeholder
    }
    blocks.push(
      `## ${r.entry.name} (${r.entry.kind}) — ${r.entry.file}:${String(r.entry.line)}\n\`\`\`\n${snippet}\n\`\`\``,
    );
  }
  return blocks.join("\n\n");
}
