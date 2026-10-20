import { z } from "zod";
import { bearer, type Fetch } from "@shepherdjerred/ops-clients/http.ts";
import { postGraphql } from "@shepherdjerred/ops-clients/graphql.ts";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

const COMMIT_CONTEXT = `
query CommitContext($owner: String!, $name: String!, $oid: GitObjectID!) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      ... on Commit {
        oid messageHeadline messageBody committedDate url
        author { name user { login } }
        associatedPullRequests(first: 1) {
          nodes { number title url mergedAt author { login } }
        }
      }
    }
  }
}`;

const CommitContextSchema = z.object({
  repository: z.object({
    object: z
      .object({
        oid: z.string(),
        messageHeadline: z.string(),
        messageBody: z.string(),
        committedDate: z.string(),
        url: z.url(),
        author: z
          .object({
            name: z.string().nullable(),
            user: z.object({ login: z.string() }).nullable(),
          })
          .nullable(),
        associatedPullRequests: z.object({
          nodes: z.array(
            z.object({
              number: z.number().int().positive(),
              title: z.string(),
              url: z.url(),
              mergedAt: z.string().nullable(),
              author: z.object({ login: z.string() }).nullable(),
            }),
          ),
        }),
      })
      .nullable(),
  }),
});

export type CommitContext = {
  oid: string;
  headline: string;
  body: string;
  committedAt: string;
  url: string;
  authorName: string | undefined;
  authorLogin: string | undefined;
  pullRequest:
    | {
        number: number;
        title: string;
        url: string;
        mergedAt: string | undefined;
        authorLogin: string | undefined;
      }
    | undefined;
};

/** One commit with its author and the pull request that introduced it. */
export async function fetchCommitContext(options: {
  owner: string;
  name: string;
  oid: string;
  token: string;
  fetch?: Fetch;
}): Promise<CommitContext> {
  const data = await postGraphql(
    options.fetch ?? fetch,
    {
      upstream: "github",
      url: GITHUB_GRAPHQL_URL,
      headers: bearer(options.token),
      query: COMMIT_CONTEXT,
      variables: { owner: options.owner, name: options.name, oid: options.oid },
    },
    CommitContextSchema,
  );
  const commit = data.repository.object;
  if (commit === null)
    throw new Error(`GitHub commit ${options.oid} does not exist`);
  const pull = commit.associatedPullRequests.nodes[0];
  return {
    oid: commit.oid,
    headline: commit.messageHeadline,
    body: commit.messageBody,
    committedAt: commit.committedDate,
    url: commit.url,
    authorName: commit.author?.name ?? undefined,
    authorLogin: commit.author?.user?.login ?? undefined,
    pullRequest:
      pull === undefined
        ? undefined
        : {
            number: pull.number,
            title: pull.title,
            url: pull.url,
            mergedAt: pull.mergedAt ?? undefined,
            authorLogin: pull.author?.login ?? undefined,
          },
  };
}
