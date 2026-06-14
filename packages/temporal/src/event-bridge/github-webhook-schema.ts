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
