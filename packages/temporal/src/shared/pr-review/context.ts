import { z } from "zod/v4";
import { SymbolEntrySchema } from "#lib/symbol-index.ts";
import { FileBlockDiffSchema } from "#lib/block-diff.ts";

/**
 * One file's slice of a PR diff. `patch` is the unified-diff hunk text as
 * returned by `octokit.rest.pulls.listFiles`; `null` when the file is binary
 * or the patch is too large for GitHub to serve (we still want the metadata).
 */
export const PrFileDiffSchema = z.object({
  path: z.string().min(1),
  status: z.enum([
    "added",
    "removed",
    "modified",
    "renamed",
    "copied",
    "changed",
    "unchanged",
  ]),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string().nullable(),
});

/**
 * A single CLAUDE.md file the reviewer should consult. `path` is repo-relative;
 * `content` is the body at the PR head SHA. We include the path because the
 * reviewer's behavior depends on which package the file applies to.
 */
export const ClaudeMdFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

/**
 * Inlined `RetrievedSymbol` for the specialist prompt — the `hybrid-retrieval`
 * module's `RetrievedSymbol` carries a `sources` array used for debugging /
 * OTel, which isn't needed at the prompt boundary. We carry just the entry
 * itself, an optional rendered snippet (resolved when the workdir exists), and
 * the score so downstream code can debug ranking.
 */
export const RetrievedSymbolForPromptSchema = z.object({
  entry: SymbolEntrySchema,
  score: z.number(),
  /**
   * Source code snippet around the symbol body, rendered by
   * `formatRetrievedSymbols`. Empty string when no workdir was available
   * (Phase-5-initial; full clone-and-render lands with the bootstrap rewrite).
   */
  snippet: z.string(),
});
export type RetrievedSymbolForPrompt = z.infer<
  typeof RetrievedSymbolForPromptSchema
>;

/**
 * The full review context: the PR metadata the model needs, every file the PR
 * touches, the CLAUDE.md hierarchy in effect at the PR head, the Phase 5
 * retrieval results (related symbols), and the Phase 6 AST-structured block
 * diffs (one per changed file, with `lineFallback` for unsupported langs).
 *
 * `workdir` is populated when the bootstrap activity has staged a real clone
 * (Phase 5+ work); Phase 2 leaves it empty. `retrievedSymbols` is `[]` until
 * the bootstrap rewrite wires retrieval against the cloned workdir.
 * `blockDiffs` is `[]` until bootstrap reads `newSource` per file; the
 * Phase 6 module supports a pure-patch fallback (it falls back to
 * `lineFallback` when the source is unavailable), but bootstrap is the
 * natural place to invoke it.
 */
export const PrReviewContextSchema = z.object({
  workdir: z.string(),
  changedFiles: z.array(PrFileDiffSchema),
  claudeMdHierarchy: z.array(ClaudeMdFileSchema),
  retrievedSymbols: z.array(RetrievedSymbolForPromptSchema),
  blockDiffs: z.array(FileBlockDiffSchema),
});

export type PrFileDiff = z.infer<typeof PrFileDiffSchema>;
export type ClaudeMdFile = z.infer<typeof ClaudeMdFileSchema>;
export type PrReviewContext = z.infer<typeof PrReviewContextSchema>;
