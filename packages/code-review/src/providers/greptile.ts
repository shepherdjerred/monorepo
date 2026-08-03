import { parseGreptileSeverity } from "../severity.ts";
import type { ReviewProvider } from "../types.ts";

/**
 * Greptile — the previous reviewer, kept as a second (dormant) implementation
 * to prove the abstraction and enable re-enabling via `REVIEW_PROVIDER=greptile`.
 *
 * Completion: Greptile posts a check-run on every reviewed commit because
 * `.greptile/config.json` sets `statusCheck:true`, so the check-run's presence
 * is a reliable "reviewed this head" marker even on a clean review.
 *
 * Skip: when Greptile declines to review (all files ignored, too many files,
 * excluded author) it posts an issue comment marked `<!-- greptile-status -->`
 * instead of a check-run; detect it so the gate short-circuits instead of
 * timing out.
 */
export const greptileProvider: ReviewProvider = {
  id: "greptile",
  displayName: "Greptile",
  botAuthoredPullRequestPolicy: "review",
  authorLogins: ["greptile-apps"],
  parseSeverity: parseGreptileSeverity,
  completion: { kind: "check-run", namePattern: /greptile/iu },
  detectSkip: {
    marker: "<!-- greptile-status -->",
    reasons: [
      { match: "No reviewable files", reason: "no-reviewable-files" },
      { match: "Too many files changed for review", reason: "too-many-files" },
      {
        match: "PR author is in the excluded authors list",
        reason: "excluded-author",
      },
    ],
  },
  // Greptile reviews automatically on every push; there is no manual trigger
  // comment to post.
  requestReview: null,
};
