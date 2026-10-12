import { z } from "zod";
import {
  isProviderAuthor,
  PROVIDERS,
  resolveProvider,
} from "@shepherdjerred/code-review";
import type { GitHubClient } from "#lib/ci/github.ts";
import { type CiReview } from "#lib/ci/github.ts";

export const CommentSchema = z.object({
  id: z.number(),
  body: z.string(),
  html_url: z.url(),
  user: z.object({ login: z.string(), type: z.string() }).nullable(),
});
const ThreadSchema = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  path: z.string().nullable(),
  line: z.number().nullable(),
  comments: z.object({
    nodes: z.array(
      z.object({
        databaseId: z.number(),
        body: z.string(),
        url: z.url(),
        author: z.object({ login: z.string() }).nullable(),
      }),
    ),
  }),
});
export type Thread = z.infer<typeof ThreadSchema>;
export type ReviewFeedback = {
  key: string;
  author: string | null;
  provider: string | null;
  priority: number | null;
  title: string | null;
  contents: string;
  path: string | null;
  line: number | null;
  isResolved: boolean;
  isOutdated: boolean;
  threadId: string | null;
  commentId: number | null;
  url: string | null;
  rawCommand: string;
};

export function providerFor(author: string | null): string | null {
  return (
    Object.values(PROVIDERS).find((provider) =>
      isProviderAuthor(provider, author),
    )?.id ?? null
  );
}

export async function threadsFor(
  github: GitHubClient,
  number: number,
): Promise<Thread[]> {
  const [owner, name] = github.repo.split("/");
  const threads: Thread[] = [];
  let cursor: string | null = null;
  for (;;) {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        authorization: `Bearer ${github.token}`,
        "Content-Type": "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        query:
          "query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated path line comments(first:1){nodes{databaseId body url author{login}}}}}}}}",
        variables: { owner, name, number, cursor },
      }),
    });
    if (!response.ok)
      throw new Error(
        `GitHub review threads failed (${String(response.status)})`,
      );
    const result = z
      .object({
        errors: z.array(z.unknown()).optional(),
        data: z
          .object({
            repository: z.object({
              pullRequest: z.object({
                reviewThreads: z.object({
                  pageInfo: z.object({
                    hasNextPage: z.boolean(),
                    endCursor: z.string().nullable(),
                  }),
                  nodes: z.array(ThreadSchema),
                }),
              }),
            }),
          })
          .optional(),
      })
      .parse(await response.json());
    if (result.errors !== undefined || result.data === undefined)
      throw new Error("GitHub did not return review threads");
    const connection = result.data.repository.pullRequest.reviewThreads;
    threads.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return threads;
    if (connection.pageInfo.endCursor === null)
      throw new Error("GitHub review pagination omitted its cursor");
    cursor = connection.pageInfo.endCursor;
  }
}

export function threadFeedback(thread: Thread, repo: string): ReviewFeedback {
  const root = thread.comments.nodes[0];
  if (root === undefined)
    throw new Error("GitHub review thread has no first comment");
  const provider = providerFor(root.author?.login ?? null);
  return {
    key: `thread:${thread.id}`,
    author: root.author?.login ?? null,
    provider,
    priority:
      provider === null
        ? null
        : resolveProvider(provider).parseSeverity(root.body),
    title:
      provider === null
        ? null
        : (resolveProvider(provider).parseFindingTitle?.(root.body) ?? null),
    contents: root.body,
    path: thread.path,
    line: thread.line,
    isResolved: thread.isResolved,
    isOutdated: thread.isOutdated,
    threadId: thread.id,
    commentId: null,
    url: root.url,
    rawCommand: `toolkit gh api repos/${repo}/pulls/comments/${String(root.databaseId)}`,
  };
}

export function reviewFeedback(
  review: CiReview,
  head: string,
  repo: string,
): ReviewFeedback {
  return {
    key: `review:${String(review.id)}`,
    author: review.user?.login ?? null,
    provider: providerFor(review.user?.login ?? null),
    priority: null,
    title: review.state,
    contents: review.body ?? "",
    path: null,
    line: null,
    isResolved: review.state === "DISMISSED",
    isOutdated: review.commit_id !== head,
    threadId: null,
    commentId: null,
    url: review.html_url,
    rawCommand: `toolkit gh api repos/${repo}/pulls/reviews/${String(review.id)}`,
  };
}

export function describeFeedback(finding: ReviewFeedback): string {
  const priority =
    finding.priority === null ? "P?" : `P${String(finding.priority)}`;
  const location =
    finding.path === null
      ? "general"
      : `${finding.path}${finding.line === null ? "" : `:${String(finding.line)}`}`;
  return `${finding.author ?? "deleted author"} ${priority} ${finding.isResolved ? "resolved" : "open"} ${location}\n${finding.contents}\n${finding.url ?? ""}\nRaw: ${finding.rawCommand}\nKey: ${finding.key}${finding.provider === null ? "" : ` --provider ${finding.provider}`}`;
}
