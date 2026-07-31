import { z } from "zod/v4";

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
 * Actions on which we run the per-PR merge-conflict check. We run on `edited`
 * too so a base-ref change re-evaluates conflict status, and we intentionally
 * do NOT include `ready_for_review` (no head change implied — the conflict
 * status is already current).
 */
export const CONFLICT_CHECK_ACTIONS = new Set([
  "opened",
  "synchronize",
  "reopened",
  "edited",
]);
