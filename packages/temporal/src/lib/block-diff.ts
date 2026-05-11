/**
 * Structure-aware block diff for the PR review pipeline (Phase 6).
 *
 * Per "To Diff or Not to Diff?" (arxiv 2604.27296), specialists do better
 * when the diff is presented at logical-block granularity (functions,
 * classes, methods) rather than as raw line-diff hunks. A 500-line refactor
 * that touches one function should surface as a single block edit, not 500
 * lines of context-line noise.
 *
 * Approach: we don't have both the base and head source available at the
 * activity layer yet (bootstrap clones the head; the patch text is the only
 * record of the base). So instead of doing a full tree-edit-distance diff,
 * we:
 *
 *   1. Parse the NEW source with tree-sitter (using the same WASM grammars
 *      as `symbol-index.ts`).
 *   2. Walk the unified-diff patch from `octokit.rest.pulls.listFiles` to
 *      extract changed-line ranges in the new-file coordinate space.
 *   3. Map each changed range to the smallest enclosing top-level block
 *      (function / class / method / etc.).
 *   4. Emit one `BlockDiff` per touched block; classify the edit
 *      (`added` / `modified` / `deleted`) by the +/- balance inside it;
 *      recurse one level for `modifiedSubBlocks` (nested methods inside a
 *      modified class).
 *
 * Unsupported languages (Lua, Python, Swift, Kotlin, plain text) fall
 * through to a `lineFallback` shape carrying the raw patch — specialists
 * still see the change, just without block names.
 *
 * Performance target: <500ms for a 500-line PR. The bottleneck is the
 * tree-sitter parse (linear in source size); we cap input at the same
 * 256KB ceiling as `symbol-index.ts`.
 */

import path from "node:path";
import { Language, Parser } from "web-tree-sitter";
import { z } from "zod/v4";
import { SymbolKindSchema, type SymbolKind } from "./symbol-index.ts";

/**
 * Languages we can parse. Matches `symbol-index.ts` exactly, by design —
 * the WASM grammars and matchers are shared.
 */
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

type BlockMatcher = {
  nodeType: string;
  kind: SymbolKind;
  nameField?: string;
};

const TOP_LEVEL_MATCHERS: Record<LanguageKey, BlockMatcher[]> = {
  typescript: [
    { nodeType: "function_declaration", kind: "function", nameField: "name" },
    { nodeType: "class_declaration", kind: "class", nameField: "name" },
    { nodeType: "interface_declaration", kind: "interface", nameField: "name" },
    { nodeType: "type_alias_declaration", kind: "type", nameField: "name" },
  ],
  tsx: [
    { nodeType: "function_declaration", kind: "function", nameField: "name" },
    { nodeType: "class_declaration", kind: "class", nameField: "name" },
    { nodeType: "interface_declaration", kind: "interface", nameField: "name" },
    { nodeType: "type_alias_declaration", kind: "type", nameField: "name" },
  ],
  javascript: [
    { nodeType: "function_declaration", kind: "function", nameField: "name" },
    { nodeType: "class_declaration", kind: "class", nameField: "name" },
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
    { nodeType: "interface_declaration", kind: "interface", nameField: "name" },
    { nodeType: "enum_declaration", kind: "enum", nameField: "name" },
  ],
};

/**
 * Sub-block matchers: nested declarations inside a top-level container that
 * we want to surface separately when the container is `modified`. A class
 * with one tweaked method should report `modifiedSubBlocks: [thatMethod]`
 * rather than just "class modified".
 */
const SUB_BLOCK_MATCHERS: Record<LanguageKey, BlockMatcher[]> = {
  typescript: [
    { nodeType: "method_definition", kind: "method", nameField: "name" },
  ],
  tsx: [{ nodeType: "method_definition", kind: "method", nameField: "name" }],
  javascript: [
    { nodeType: "method_definition", kind: "method", nameField: "name" },
  ],
  rust: [{ nodeType: "function_item", kind: "function", nameField: "name" }],
  go: [], // Go methods are top-level via method_declaration; no sub-blocks
  java: [{ nodeType: "method_declaration", kind: "method", nameField: "name" }],
};

const MAX_FILE_BYTES = 256 * 1024;

export const BlockEditKindSchema = z.enum([
  "added",
  "removed",
  "modified",
  "unchanged",
]);
export type BlockEditKind = z.infer<typeof BlockEditKindSchema>;

export const BlockRangeSchema = z.object({
  /** 1-indexed start line in the new file. */
  startLine: z.number().int().positive(),
  /** 1-indexed end line in the new file. */
  endLine: z.number().int().positive(),
});
export type BlockRange = z.infer<typeof BlockRangeSchema>;

export const ChangedHunkSchema = z.object({
  /** 1-indexed start line in the new file (`@@ -X,Y +A,B @@` → `A`). */
  newStart: z.number().int().nonnegative(),
  /** Line count in the new file (`@@ -X,Y +A,B @@` → `B`). */
  newCount: z.number().int().nonnegative(),
  /** Number of added (`+`) lines in this hunk body. */
  addedLines: z.number().int().nonnegative(),
  /** Number of removed (`-`) lines in this hunk body. */
  removedLines: z.number().int().nonnegative(),
});
export type ChangedHunk = z.infer<typeof ChangedHunkSchema>;

export const SubBlockDiffSchema = z.object({
  kind: SymbolKindSchema,
  name: z.string(),
  range: BlockRangeSchema,
  edit: BlockEditKindSchema,
  addedLines: z.number().int().nonnegative(),
  removedLines: z.number().int().nonnegative(),
});
export type SubBlockDiff = z.infer<typeof SubBlockDiffSchema>;

export const BlockDiffSchema = z.object({
  kind: SymbolKindSchema,
  name: z.string(),
  range: BlockRangeSchema,
  edit: BlockEditKindSchema,
  /** Total +/- counts inside this block's range. */
  addedLines: z.number().int().nonnegative(),
  removedLines: z.number().int().nonnegative(),
  /** Nested sub-blocks (methods inside classes, etc.) with their own edits. */
  modifiedSubBlocks: z.array(SubBlockDiffSchema),
});
export type BlockDiff = z.infer<typeof BlockDiffSchema>;

export const FileBlockDiffSchema = z.object({
  file: z.string(),
  /** `null` when the language is unsupported — see `lineFallback`. */
  language: z
    .union([
      z.literal("typescript"),
      z.literal("tsx"),
      z.literal("javascript"),
      z.literal("rust"),
      z.literal("go"),
      z.literal("java"),
    ])
    .nullable(),
  /** Blocks that touch any changed line range. */
  blocks: z.array(BlockDiffSchema),
  /** Hunks that don't fall inside any tracked top-level block. */
  orphanHunks: z.array(ChangedHunkSchema),
  /** Set when `language === null` — raw patch retained verbatim. */
  lineFallback: z.string().nullable(),
});
export type FileBlockDiff = z.infer<typeof FileBlockDiffSchema>;

/** Hunk header regex matching unified diff `@@ -a,b +c,d @@` (and `+c` w/o count). */
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse a unified-diff patch and yield the changed-hunk descriptors.
 *
 * Returns hunks in the order they appear in the patch (i.e. ascending new
 * file position). `newStart` is the value from the hunk header; `newCount`
 * defaults to 1 when the header omits it (`@@ -3 +5 @@` style).
 */
export function parsePatchHunks(patch: string): ChangedHunk[] {
  const out: ChangedHunk[] = [];
  const lines = patch.split("\n");
  let current: ChangedHunk | null = null;
  for (const line of lines) {
    const header = HUNK_HEADER_RE.exec(line);
    if (header !== null) {
      if (current !== null) out.push(current);
      const newStart = Number.parseInt(header[1] ?? "0", 10);
      const newCount =
        header[2] === undefined ? 1 : Number.parseInt(header[2], 10);
      current = {
        newStart,
        newCount,
        addedLines: 0,
        removedLines: 0,
      };
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      current.addedLines += 1;
    } else if (line.startsWith("-")) {
      current.removedLines += 1;
    }
  }
  if (current !== null) out.push(current);
  return out;
}

/**
 * Map an extension to its language key. Returns `null` for unsupported
 * extensions; callers fall back to `lineFallback`.
 */
function languageForFile(filePath: string): LanguageKey | null {
  const ext = path.extname(filePath);
  for (const candidate of SUPPORTED_EXTENSIONS) {
    if (candidate === ext) {
      return EXTENSION_TO_LANGUAGE[candidate];
    }
  }
  return null;
}

let parserInitPromise: Promise<void> | null = null;
const languageCache = new Map<LanguageKey, Language>();

async function ensureParser(): Promise<void> {
  parserInitPromise ??= Parser.init({
    locateFile(file: string): string {
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
 * Tree-sitter syntax node — the structural slice we read off of a parsed
 * tree. The real type from `web-tree-sitter` is larger; this captures
 * exactly the fields we use.
 */
type TsNode = {
  startPosition: { row: number };
  endPosition: { row: number };
  childForFieldName: (field: string) => TsNode | null;
  descendantsOfType: (types: string | string[]) => TsNode[];
  text: string;
};

type ParsedTopBlock = {
  kind: SymbolKind;
  name: string;
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed
  subBlocks: ParsedSubBlock[];
};

type ParsedSubBlock = {
  kind: SymbolKind;
  name: string;
  startLine: number;
  endLine: number;
};

/**
 * Extract top-level blocks (and their sub-blocks) from a parsed source
 * string. Pure: no I/O, no caching.
 */
export async function extractTopLevelBlocks(input: {
  source: string;
  language: LanguageKey;
}): Promise<ParsedTopBlock[]> {
  const { source, language } = input;
  const lang = await loadLanguage(language);
  const parser = new Parser();
  parser.setLanguage(lang);
  try {
    const tree = parser.parse(source);
    if (tree === null) return [];
    const out: ParsedTopBlock[] = [];
    const topMatchers = TOP_LEVEL_MATCHERS[language];
    const subMatchers = SUB_BLOCK_MATCHERS[language];
    for (const matcher of topMatchers) {
      const nodes = tree.rootNode.descendantsOfType(matcher.nodeType);
      for (const node of nodes) {
        const name = readNodeName(node, matcher.nameField);
        if (name === null) continue;
        out.push({
          kind: matcher.kind,
          name,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          subBlocks: extractSubBlocks(node, subMatchers),
        });
      }
    }
    return out.toSorted((a, b) => a.startLine - b.startLine);
  } finally {
    parser.delete();
  }
}

function readNodeName(node: TsNode, nameField?: string): string | null {
  if (nameField !== undefined) {
    const nameNode = node.childForFieldName(nameField);
    if (nameNode !== null) return nameNode.text;
  }
  // Go's `type_declaration` wraps a `type_spec` whose `name` field carries
  // the actual identifier; fall back to the first identifier-y descendant.
  const fallback = node
    .descendantsOfType(["type_identifier", "identifier"])
    .at(0);
  if (fallback !== undefined) return fallback.text;
  return null;
}

function extractSubBlocks(
  parent: TsNode,
  matchers: readonly BlockMatcher[],
): ParsedSubBlock[] {
  if (matchers.length === 0) return [];
  const out: ParsedSubBlock[] = [];
  for (const matcher of matchers) {
    for (const node of parent.descendantsOfType(matcher.nodeType)) {
      const name = readNodeName(node, matcher.nameField);
      if (name === null) continue;
      out.push({
        kind: matcher.kind,
        name,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
    }
  }
  return out.toSorted((a, b) => a.startLine - b.startLine);
}

/**
 * Classify a block's edit kind given the +/- balance inside its range. A
 * block whose entire body is `+` lines was added; entirely `-` lines, removed;
 * a mix is modified; zero touches means unchanged (won't appear in output).
 */
function classifyEdit(
  block: { startLine: number; endLine: number },
  hunks: readonly ChangedHunk[],
): {
  edit: BlockEditKind;
  addedLines: number;
  removedLines: number;
} {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    const hunkEnd = h.newStart + h.newCount - 1;
    if (hunkEnd < block.startLine) continue;
    if (h.newStart > block.endLine) continue;
    // Hunk overlaps the block. We don't have per-line granularity for which
    // +/- lines fall inside vs. outside the block boundary, so attribute the
    // full hunk to the block. Acceptable approximation: hunks rarely span
    // multiple top-level blocks, and when they do they're caught as overlaps.
    added += h.addedLines;
    removed += h.removedLines;
  }
  if (added === 0 && removed === 0) {
    return { edit: "unchanged", addedLines: 0, removedLines: 0 };
  }
  if (added > 0 && removed === 0) {
    // Could be a brand-new block, or net-addition inside an existing one.
    // Without the base source we can't distinguish; default to "modified"
    // unless the entire block range is inside an added hunk.
    const fullyInside = hunks.some(
      (h) =>
        h.newStart <= block.startLine &&
        h.newStart + h.newCount - 1 >= block.endLine,
    );
    return {
      edit: fullyInside ? "added" : "modified",
      addedLines: added,
      removedLines: removed,
    };
  }
  if (removed > 0 && added === 0) {
    return { edit: "removed", addedLines: 0, removedLines: removed };
  }
  return { edit: "modified", addedLines: added, removedLines: removed };
}

function hunkInsideRange(
  hunk: ChangedHunk,
  startLine: number,
  endLine: number,
): boolean {
  const hunkEnd = hunk.newStart + hunk.newCount - 1;
  return hunk.newStart <= endLine && hunkEnd >= startLine;
}

/**
 * Compute the block diff for a single file. `newSource` is the file contents
 * at the PR head SHA (post-change). `patch` is the unified-diff patch from
 * `octokit.rest.pulls.listFiles`. `filePath` is repo-relative.
 */
export async function computeFileBlockDiff(input: {
  filePath: string;
  newSource: string;
  patch: string;
}): Promise<FileBlockDiff> {
  const { filePath, newSource, patch } = input;
  const language = languageForFile(filePath);
  const hunks = parsePatchHunks(patch);

  if (language === null) {
    return {
      file: filePath,
      language: null,
      blocks: [],
      orphanHunks: hunks,
      lineFallback: patch,
    };
  }

  if (newSource.length > MAX_FILE_BYTES) {
    // Oversize file — degrade to lineFallback (specialists still see the
    // patch, just without block names).
    return {
      file: filePath,
      language,
      blocks: [],
      orphanHunks: hunks,
      lineFallback: patch,
    };
  }

  const topBlocks = await extractTopLevelBlocks({
    source: newSource,
    language,
  });

  const blocks: BlockDiff[] = [];
  const hunksConsumedByBlock = new Set<number>();

  for (const top of topBlocks) {
    const classification = classifyEdit(top, hunks);
    if (classification.edit === "unchanged") {
      continue;
    }
    const subBlockDiffs: SubBlockDiff[] = [];
    for (const sub of top.subBlocks) {
      const subClass = classifyEdit(sub, hunks);
      if (subClass.edit === "unchanged") continue;
      subBlockDiffs.push({
        kind: sub.kind,
        name: sub.name,
        range: { startLine: sub.startLine, endLine: sub.endLine },
        edit: subClass.edit,
        addedLines: subClass.addedLines,
        removedLines: subClass.removedLines,
      });
    }
    blocks.push({
      kind: top.kind,
      name: top.name,
      range: { startLine: top.startLine, endLine: top.endLine },
      edit: classification.edit,
      addedLines: classification.addedLines,
      removedLines: classification.removedLines,
      modifiedSubBlocks: subBlockDiffs,
    });
    for (const [i, hunk] of hunks.entries()) {
      if (hunkInsideRange(hunk, top.startLine, top.endLine)) {
        hunksConsumedByBlock.add(i);
      }
    }
  }

  const orphanHunks = hunks.filter((_, i) => !hunksConsumedByBlock.has(i));

  return {
    file: filePath,
    language,
    blocks,
    orphanHunks,
    lineFallback: null,
  };
}

/**
 * Format a `FileBlockDiff` into a prompt-ready Markdown section. Caller
 * wraps the result inside a "### `<path>`" header. Falls through to the raw
 * patch when `lineFallback` is set.
 */
export function formatBlockDiff(diff: FileBlockDiff): string {
  if (diff.lineFallback !== null) {
    return ["```diff", diff.lineFallback, "```"].join("\n");
  }
  if (diff.blocks.length === 0 && diff.orphanHunks.length === 0) {
    return "_(no structural changes detected)_";
  }
  const lines: string[] = [];
  if (diff.blocks.length > 0) {
    lines.push("**Modified blocks:**");
    lines.push("");
    for (const b of diff.blocks) {
      lines.push(
        `- \`${b.name}\` (${b.kind}) — ${b.edit} at L${String(b.range.startLine)}-${String(b.range.endLine)} (+${String(b.addedLines)} / -${String(b.removedLines)})`,
      );
      for (const sub of b.modifiedSubBlocks) {
        lines.push(
          `  - sub: \`${sub.name}\` (${sub.kind}) — ${sub.edit} at L${String(sub.range.startLine)}-${String(sub.range.endLine)} (+${String(sub.addedLines)} / -${String(sub.removedLines)})`,
        );
      }
    }
    lines.push("");
  }
  if (diff.orphanHunks.length > 0) {
    lines.push("**Top-level changes (not inside any tracked block):**");
    lines.push("");
    for (const h of diff.orphanHunks) {
      lines.push(
        `- L${String(h.newStart)}-${String(h.newStart + h.newCount - 1)} (+${String(h.addedLines)} / -${String(h.removedLines)})`,
      );
    }
  }
  return lines.join("\n");
}
