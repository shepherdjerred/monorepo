import { z } from "zod";

export const PullRequestSchema = z.object({
  number: z.number().int().positive(),
  url: z.url(),
  headRefOid: z.string().min(1),
  isDraft: z.boolean(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  mergedAt: z.string().nullable(),
  baseRefName: z.string().min(1),
  headRefName: z.string().min(1),
  mergeCommit: z.object({ oid: z.string().regex(/^[0-9a-f]{40}$/) }).nullable(),
  author: z.object({ login: z.string(), is_bot: z.boolean() }),
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

export const pullRequestFields = Object.keys(PullRequestSchema.shape).join(",");

export const OpenPullRequestListSchema = z.array(
  z.object({
    number: z.number().int().positive(),
    user: z.object({ login: z.string(), type: z.string() }).nullable(),
  }),
);

export function isBotPullRequestAuthor(
  author: PullRequest["author"],
  expectedLogin: string,
): boolean {
  // gh serializes GraphQL Bot actors as app/<slug>; REST uses <slug>[bot].
  const appLogin = expectedLogin.endsWith("[bot]")
    ? `app/${expectedLogin.slice(0, -"[bot]".length)}`
    : undefined;
  return (
    author.is_bot &&
    (author.login === expectedLogin || author.login === appLogin)
  );
}
