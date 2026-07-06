import { z } from "zod/v4";

export const RELEVANT_ACTIONS = new Set([
  "opened",
  "synchronize",
  "reopened",
  "ready_for_review",
]);

// Security: PR automation (the review/summary pipelines — whose verify stage
// checks out and executes PR-head code) must only run for the trusted
// repository owner. The repo is public, so without this gate any external
// fork PR's title/diff/code would flow into the agents and the verifier.
const ALLOWED_PR_AUTHOR = "shepherdjerred";

// Returns a skip reason (for metrics/logs) when a PR's author is not the
// trusted owner — bots and any non-owner account are skipped — or null to
// proceed.
export function disallowedAuthorReason(user: {
  readonly login: string;
  readonly type: string;
}): string | null {
  if (user.type === "Bot") return "bot-author";
  if (user.login !== ALLOWED_PR_AUTHOR) return "untrusted-author";
  return null;
}

const PrUserSchema = z.object({
  login: z.string(),
  type: z.string(),
});

const PrRefSchema = z.object({
  ref: z.string(),
  sha: z.string(),
});

const PrSchema = z.object({
  number: z.number().int().positive(),
  draft: z.boolean().optional(),
  merged: z.boolean().optional(),
  title: z.string(),
  base: PrRefSchema,
  head: PrRefSchema,
  user: PrUserSchema,
});

const RepoOwnerSchema = z.object({ login: z.string() });

const RepoSchema = z.object({
  name: z.string(),
  owner: RepoOwnerSchema,
});

export const PullRequestEventSchema = z.object({
  action: z.string(),
  pull_request: PrSchema,
  repository: RepoSchema,
});

/**
 * Subset of GitHub's `push` webhook payload we care about for the
 * merge-conflict checker. We only read the ref (to gate on `refs/heads/main`),
 * the post-push HEAD (`after`), and the repository identity.
 */
export const PushEventSchema = z.object({
  ref: z.string(),
  after: z.string(),
  repository: RepoSchema,
});

/**
 * Actions on which we run the per-PR merge-conflict check. Distinct from
 * `RELEVANT_ACTIONS` (which gates the review/summary pipelines): we run on
 * `edited` too so a base-ref change re-evaluates conflict status, and we
 * intentionally do NOT include `ready_for_review` (no head change implied —
 * the conflict status is already current).
 */
export const CONFLICT_CHECK_ACTIONS = new Set([
  "opened",
  "synchronize",
  "reopened",
  "edited",
]);

const IssueCommentUserSchema = z.object({
  login: z.string(),
  type: z.string(),
});

const IssueCommentCommentSchema = z.object({
  id: z.number().int(),
  body: z.string(),
  user: IssueCommentUserSchema,
  // OWNER | MEMBER | COLLABORATOR | CONTRIBUTOR | NONE | …
  author_association: z.string(),
});

// `issue_comment` fires on plain issues too; the presence of `pull_request`
// marks the issue as a PR (and `issue.number` is the PR number — issues and PRs
// share the numbering space).
const IssueCommentIssueSchema = z.object({
  number: z.number().int().positive(),
  pull_request: z.object({ url: z.string() }).optional(),
});

export const IssueCommentEventSchema = z.object({
  action: z.string(),
  comment: IssueCommentCommentSchema,
  issue: IssueCommentIssueSchema,
  repository: RepoSchema,
});

export type IssueCommentEvent = z.infer<typeof IssueCommentEventSchema>;

/**
 * Owner-only authorization for babysitter commands (defense in depth: OWNER
 * association AND the trusted login). The repo is public and the babysitter has
 * push + token-minting power, so the bar is "the repo owner, full stop".
 * Returns a skip reason for metrics/logs, or null to proceed.
 */
export function babysitCommandAuthz(comment: {
  readonly user: { readonly login: string; readonly type: string };
  readonly author_association: string;
}): string | null {
  if (comment.user.type === "Bot") return "bot-author";
  if (comment.author_association !== "OWNER") return "not-owner-association";
  if (comment.user.login !== ALLOWED_PR_AUTHOR) return "untrusted-login";
  return null;
}
