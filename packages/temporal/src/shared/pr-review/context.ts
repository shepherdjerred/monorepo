import { z } from "zod/v4";

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
 * The full review context: the PR metadata the model needs, every file the PR
 * touches, and the CLAUDE.md hierarchy that was in effect at the PR head.
 *
 * `workdir` is populated when the bootstrap activity has staged a real clone
 * (Phase 5+ work); Phase 2 leaves it empty.
 */
export const PrReviewContextSchema = z.object({
  workdir: z.string(),
  changedFiles: z.array(PrFileDiffSchema),
  claudeMdHierarchy: z.array(ClaudeMdFileSchema),
});

export type PrFileDiff = z.infer<typeof PrFileDiffSchema>;
export type ClaudeMdFile = z.infer<typeof ClaudeMdFileSchema>;
export type PrReviewContext = z.infer<typeof PrReviewContextSchema>;
