import type { SymbolEntry, SymbolIndex } from "./symbol-index.ts";

/**
 * Lexical symbol retrieval for the PR review pipeline: identifier tokens
 * extracted from changed-line text, looked up against `SymbolIndex.byName`,
 * ranked by the number of distinct identifiers resolving to the same entry.
 *
 * Per the RARe paper (arxiv 2511.05302), top-1 retrieval beats top-K;
 * default `k=1`.
 */

export type RetrievedSymbol = {
  entry: SymbolEntry;
  /** Distinct diff identifiers that resolved to this entry (higher is better). */
  score: number;
};

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
 * For every identifier in the diff, look it up in the symbol index. Ranks by
 * the number of distinct identifiers that resolve to the same symbol entry
 * (multi-occurrence is a strong signal).
 */
export function lexicalRetrieve(
  diff: string,
  index: SymbolIndex,
): RetrievedSymbol[] {
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
    .map((h) => ({ entry: h.entry, score: h.count }));
}

export type RetrieveSymbolsOptions = {
  diff: string;
  index: SymbolIndex;
  /**
   * Top-K to return. Default 1 per the RARe paper — top-1 retrieval beats
   * top-K because additional context dilutes the signal.
   */
  k?: number;
};

export function retrieveSymbols(
  options: RetrieveSymbolsOptions,
): RetrievedSymbol[] {
  const k = options.k ?? 1;
  return lexicalRetrieve(options.diff, options.index).slice(0, k);
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
