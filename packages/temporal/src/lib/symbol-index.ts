import path from "node:path";
import { Glob } from "bun";
import { Language, Parser } from "web-tree-sitter";
import { z } from "zod/v4";

/**
 * Symbol-graph builder for the PR review pipeline. Per the SOTA plan
 * (`packages/docs/plans/2026-05-10_sota-pr-review-bot.md`, Phase 5), the
 * specialists get cross-file context by looking up symbols referenced in the
 * diff against an index of all top-level declarations in the repo.
 *
 * Design choices:
 *  - WASM grammars from `@vscode/tree-sitter-wasm` (MIT, zero deps). Six
 *    languages: TS, TSX, JS, Rust, Go, Java — exactly the plan's coverage.
 *  - Symbols extracted via `descendantsOfType` queries — faster than walking.
 *  - Per-commit on-disk cache at `/tmp/pr-review-symbol-cache/<sha>/` so a
 *    re-run on the same SHA is instant.
 */

export const SymbolKindSchema = z.enum([
  "function",
  "class",
  "method",
  "interface",
  "type",
  "struct",
  "trait",
  "enum",
  "module",
]);
export type SymbolKind = z.infer<typeof SymbolKindSchema>;

export const SymbolEntrySchema = z.object({
  name: z.string().min(1),
  kind: SymbolKindSchema,
  /** Repo-root-relative POSIX path. */
  file: z.string().min(1),
  /** 1-indexed start line. */
  line: z.number().int().positive(),
  /** 1-indexed end line. */
  endLine: z.number().int().positive(),
});
export type SymbolEntry = z.infer<typeof SymbolEntrySchema>;

/**
 * Public index shape. Two Maps share entry references — `byName` for symbol
 * lookups during retrieval, `byFile` for file → defs in that file.
 */
export type SymbolIndex = {
  commitSha: string;
  byName: Map<string, SymbolEntry[]>;
  byFile: Map<string, SymbolEntry[]>;
  /** Wall-clock build duration; reported by the activity for OTel. */
  buildMs: number;
  /** Files scanned. */
  filesScanned: number;
};

const SUPPORTED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".rs",
  ".go",
  ".java",
] as const;
type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

type LanguageKey = "typescript" | "tsx" | "javascript" | "rust" | "go" | "java";

const EXTENSION_TO_LANGUAGE: Record<SupportedExtension, LanguageKey> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
};

const LANGUAGE_TO_WASM: Record<LanguageKey, string> = {
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript.wasm",
  rust: "tree-sitter-rust.wasm",
  go: "tree-sitter-go.wasm",
  java: "tree-sitter-java.wasm",
};

/**
 * Per-language node-type matchers. Each entry pairs a tree-sitter node type
 * with the SymbolKind we record. The order doesn't matter — we union the
 * results from `descendantsOfType` for each declared type.
 */
const LANGUAGE_MATCHERS: Record<
  LanguageKey,
  { nodeType: string; kind: SymbolKind; nameField?: string }[]
> = {
  typescript: [
    { nodeType: "function_declaration", kind: "function", nameField: "name" },
    { nodeType: "class_declaration", kind: "class", nameField: "name" },
    { nodeType: "method_definition", kind: "method", nameField: "name" },
    { nodeType: "interface_declaration", kind: "interface", nameField: "name" },
    { nodeType: "type_alias_declaration", kind: "type", nameField: "name" },
  ],
  tsx: [
    { nodeType: "function_declaration", kind: "function", nameField: "name" },
    { nodeType: "class_declaration", kind: "class", nameField: "name" },
    { nodeType: "method_definition", kind: "method", nameField: "name" },
    { nodeType: "interface_declaration", kind: "interface", nameField: "name" },
    { nodeType: "type_alias_declaration", kind: "type", nameField: "name" },
  ],
  javascript: [
    { nodeType: "function_declaration", kind: "function", nameField: "name" },
    { nodeType: "class_declaration", kind: "class", nameField: "name" },
    { nodeType: "method_definition", kind: "method", nameField: "name" },
  ],
  rust: [
    { nodeType: "function_item", kind: "function", nameField: "name" },
    { nodeType: "struct_item", kind: "struct", nameField: "name" },
    { nodeType: "trait_item", kind: "trait", nameField: "name" },
    { nodeType: "enum_item", kind: "enum", nameField: "name" },
    { nodeType: "mod_item", kind: "module", nameField: "name" },
  ],
  go: [
    { nodeType: "function_declaration", kind: "function", nameField: "name" },
    { nodeType: "method_declaration", kind: "method", nameField: "name" },
    { nodeType: "type_declaration", kind: "type" },
  ],
  java: [
    { nodeType: "class_declaration", kind: "class", nameField: "name" },
    { nodeType: "method_declaration", kind: "method", nameField: "name" },
    { nodeType: "interface_declaration", kind: "interface", nameField: "name" },
    { nodeType: "enum_declaration", kind: "enum", nameField: "name" },
  ],
};

const SYMBOL_CACHE_ROOT = "/tmp/pr-review-symbol-cache";

/**
 * Default glob patterns. The list mirrors `bun.workspaces` discovery patterns
 * for the monorepo — top-level files in `packages/*` plus `scripts/ci/src/`.
 * Skips common generated / vendored directories.
 */
const DEFAULT_INCLUDE_GLOBS = [
  "packages/*/src/**/*.{ts,tsx,js,rs,go,java}",
  "packages/*/packages/*/src/**/*.{ts,tsx,js,rs,go,java}",
  "scripts/ci/src/**/*.{ts,tsx,js}",
] as const;
const DEFAULT_EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".dagger",
  "generated",
  "__snapshots__",
  ".bun",
  "target", // Rust build output
]);
const MAX_FILE_BYTES = 256 * 1024; // 256KB — generated bundles bloat the index

let parserInitPromise: Promise<void> | null = null;
const languageCache = new Map<LanguageKey, Language>();

/**
 * Lazy-initialize the tree-sitter runtime + cache per-language `Language`
 * objects. Called the first time we parse a file in a given language; safe
 * to call repeatedly.
 */
async function ensureParser(): Promise<void> {
  parserInitPromise ??= Parser.init({
    locateFile(file: string): string {
      // The runtime WASM ships next to the JS module.
      return new URL(
        `../../node_modules/web-tree-sitter/${file}`,
        import.meta.url,
      ).pathname;
    },
  });
  await parserInitPromise;
}

async function loadLanguage(lang: LanguageKey): Promise<Language> {
  const cached = languageCache.get(lang);
  if (cached !== undefined) {
    return cached;
  }
  await ensureParser();
  const wasmPath = new URL(
    `../../node_modules/@vscode/tree-sitter-wasm/wasm/${LANGUAGE_TO_WASM[lang]}`,
    import.meta.url,
  ).pathname;
  const bytes = await Bun.file(wasmPath).bytes();
  const language = await Language.load(bytes);
  languageCache.set(lang, language);
  return language;
}

/**
 * Map extension → language. Returns `null` for unsupported extensions; the
 * truthy return value's `language` field is the LanguageKey for routing. Used
 * instead of a `is`-typed guard because the custom no-type-guards ESLint rule
 * prefers Map-based / structural narrowing over user-defined type predicates.
 */
function languageForFile(
  filePath: string,
): { ext: SupportedExtension; language: LanguageKey } | null {
  const ext = path.extname(filePath);
  for (const candidate of SUPPORTED_EXTENSIONS) {
    if (candidate === ext) {
      return { ext: candidate, language: EXTENSION_TO_LANGUAGE[candidate] };
    }
  }
  return null;
}

/**
 * Parse a single file and extract top-level symbol declarations. Pure function
 * over (filePath, source, language) — no I/O, no caching. The caller decides
 * read order, concurrency, and caching.
 */
export async function extractSymbolsFromSource(input: {
  /** Repo-root-relative POSIX path used in the resulting entries. */
  filePath: string;
  source: string;
  language: LanguageKey;
}): Promise<SymbolEntry[]> {
  const { filePath, source, language } = input;
  const lang = await loadLanguage(language);
  const parser = new Parser();
  parser.setLanguage(lang);
  try {
    const tree = parser.parse(source);
    if (tree === null) {
      return [];
    }
    const out: SymbolEntry[] = [];
    const matchers = LANGUAGE_MATCHERS[language];
    for (const matcher of matchers) {
      const nodes = tree.rootNode.descendantsOfType(matcher.nodeType);
      for (const node of nodes) {
        const nameNode =
          matcher.nameField === undefined
            ? null
            : node.childForFieldName(matcher.nameField);
        // Some node types (e.g. Go's `type_declaration`) wrap a `type_spec`
        // child whose `name` field carries the actual identifier. Fall back
        // to the first named descendant of type `type_identifier` /
        // `identifier` for those.
        const name =
          nameNode?.text ??
          node.descendantsOfType(["type_identifier", "identifier"]).at(0)?.text;
        if (name === undefined || name.length === 0) {
          continue;
        }
        out.push({
          name,
          kind: matcher.kind,
          file: filePath,
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
    }
    return out;
  } finally {
    parser.delete();
  }
}

async function readSourceFile(absPath: string): Promise<string | null> {
  const file = Bun.file(absPath);
  const size = file.size;
  if (size === 0 || size > MAX_FILE_BYTES) {
    return null;
  }
  return await file.text();
}

function shouldSkipPath(relPath: string): boolean {
  for (const part of relPath.split("/")) {
    if (DEFAULT_EXCLUDE_DIRS.has(part)) return true;
  }
  return false;
}

async function processFile(
  absPath: string,
  relPath: string,
): Promise<SymbolEntry[]> {
  if (shouldSkipPath(relPath)) {
    return [];
  }
  const langInfo = languageForFile(relPath);
  if (langInfo === null) {
    return [];
  }
  const source = await readSourceFile(absPath);
  if (source === null) {
    return [];
  }
  return extractSymbolsFromSource({
    filePath: relPath,
    source,
    language: langInfo.language,
  });
}

function cachePathFor(commitSha: string): string {
  return path.join(SYMBOL_CACHE_ROOT, commitSha, "index.json");
}

const CachedIndexSchema = z.object({
  commitSha: z.string(),
  entries: z.array(SymbolEntrySchema),
});

async function tryReadCache(commitSha: string): Promise<SymbolEntry[] | null> {
  try {
    const file = Bun.file(cachePathFor(commitSha));
    if (!(await file.exists())) {
      return null;
    }
    const raw = await file.text();
    const parsed = CachedIndexSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.commitSha !== commitSha) {
      return null;
    }
    return parsed.data.entries;
  } catch {
    return null;
  }
}

async function writeCache(
  commitSha: string,
  entries: readonly SymbolEntry[],
): Promise<void> {
  const cachePath = cachePathFor(commitSha);
  // JSON.stringify takes `unknown`, so the readonly→mutable mismatch only
  // matters if we annotate. Inline the object literal.
  await Bun.write(cachePath, JSON.stringify({ commitSha, entries }));
}

function indexFromEntries(
  commitSha: string,
  entries: readonly SymbolEntry[],
  buildMs: number,
  filesScanned: number,
): SymbolIndex {
  const byName = new Map<string, SymbolEntry[]>();
  const byFile = new Map<string, SymbolEntry[]>();
  for (const e of entries) {
    const nameBucket = byName.get(e.name);
    if (nameBucket === undefined) {
      byName.set(e.name, [e]);
    } else {
      nameBucket.push(e);
    }
    const fileBucket = byFile.get(e.file);
    if (fileBucket === undefined) {
      byFile.set(e.file, [e]);
    } else {
      fileBucket.push(e);
    }
  }
  return { commitSha, byName, byFile, buildMs, filesScanned };
}

export type BuildSymbolIndexOptions = {
  repoRoot: string;
  commitSha: string;
  /** Override the default include globs (mainly for tests). */
  includeGlobs?: readonly string[];
  /** Skip the on-disk cache lookup. Default false. */
  forceRebuild?: boolean;
};

/**
 * Build the symbol index over a workspace. Reads from disk; honors the
 * on-disk cache keyed by `commitSha` unless `forceRebuild` is set.
 *
 * Performance target (per Phase 5 task): the full monorepo index builds
 * in <60s on warm cache. The on-disk cache makes the warm path effectively
 * instant; the cold path's perf will be measured against the real tree.
 */
export async function buildSymbolIndex(
  options: BuildSymbolIndexOptions,
): Promise<SymbolIndex> {
  const start = performance.now();
  const { repoRoot, commitSha, forceRebuild = false } = options;
  const includeGlobs = options.includeGlobs ?? DEFAULT_INCLUDE_GLOBS;

  if (!forceRebuild) {
    const cached = await tryReadCache(commitSha);
    if (cached !== null) {
      const elapsed = performance.now() - start;
      return indexFromEntries(commitSha, cached, elapsed, cached.length);
    }
  }

  // Discover files across all globs. Use a Set keyed by abs path so files
  // matched by multiple globs are only processed once.
  const absPaths = new Set<string>();
  for (const glob of includeGlobs) {
    const scanner = new Glob(glob);
    for await (const match of scanner.scan({
      cwd: repoRoot,
      onlyFiles: true,
    })) {
      absPaths.add(path.join(repoRoot, match));
    }
  }

  const entries: SymbolEntry[] = [];
  let filesScanned = 0;
  // Bounded parallelism — too high churns the WASM heap. 8 is a starting
  // point; will tune against real-repo timings.
  const concurrency = 8;
  const sortedPaths = [...absPaths].toSorted();
  for (let i = 0; i < sortedPaths.length; i += concurrency) {
    const batch = sortedPaths.slice(i, i + concurrency);
    const batchEntries = await Promise.all(
      batch.map((absPath) => {
        const relPath = path.relative(repoRoot, absPath);
        return processFile(absPath, relPath);
      }),
    );
    for (const fileEntries of batchEntries) {
      if (fileEntries.length > 0) {
        entries.push(...fileEntries);
      }
      filesScanned += 1;
    }
  }

  await writeCache(commitSha, entries);
  const buildMs = performance.now() - start;
  return indexFromEntries(commitSha, entries, buildMs, filesScanned);
}

/**
 * Lookup a symbol by exact name. Returns all definitions across the repo —
 * caller decides how to rank.
 */
export function lookupSymbol(
  index: SymbolIndex,
  name: string,
): readonly SymbolEntry[] {
  return index.byName.get(name) ?? [];
}

/**
 * Lookup all definitions in a given file. Used to seed retrieval when we
 * want "all symbols defined in this changed file" as a starting point.
 */
export function lookupByFile(
  index: SymbolIndex,
  file: string,
): readonly SymbolEntry[] {
  return index.byFile.get(file) ?? [];
}
