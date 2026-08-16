/**
 * Reading the PR's review threads off GitHub's GraphQL API and normalising each
 * one into a {@link ReviewThread}. Kept apart from the completion strategies it
 * feeds: this is the shape of GitHub's payload, not a decision about it.
 */

import {
  arrayField,
  asRecord,
  boolField,
  numberField,
  recordField,
  stringField,
} from "./github-http.ts";
import type { ReviewProvider, ReviewThread } from "./types.ts";

export const REVIEW_THREADS_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 1) {
            nodes { author { login } url body }
          }
        }
      }
    }
  }
}`;

export function parseThreadPage(
  payload: unknown,
  provider: ReviewProvider,
): {
  headRefOid: string | null;
  threads: ReviewThread[];
  hasNextPage: boolean;
  endCursor: string | null;
} {
  const payloadRecord = asRecord(payload);
  const data =
    payloadRecord === null ? null : recordField(payloadRecord, "data");
  const repository = data === null ? null : recordField(data, "repository");
  const pullRequest =
    repository === null ? null : recordField(repository, "pullRequest");
  if (pullRequest === null) {
    throw new Error(
      "GitHub GraphQL response did not include repository.pullRequest",
    );
  }
  const reviewThreads = recordField(pullRequest, "reviewThreads");
  if (reviewThreads === null) {
    throw new Error("GitHub GraphQL response did not include reviewThreads");
  }

  const threads: ReviewThread[] = [];
  for (const rawNode of arrayField(reviewThreads, "nodes")) {
    const node = asRecord(rawNode);
    if (node === null) continue;
    const comments = recordField(node, "comments");
    const commentNodes = comments === null ? [] : arrayField(comments, "nodes");
    const firstComment = asRecord(commentNodes[0]);
    let authorLogin: string | null = null;
    let url: string | null = null;
    let priority: number | null = null;
    let title: string | null = null;
    if (firstComment !== null) {
      const author = recordField(firstComment, "author");
      const body = stringField(firstComment, "body");
      authorLogin = author === null ? null : stringField(author, "login");
      url = stringField(firstComment, "url");
      priority = provider.parseSeverity(body);
      // A thread is addressable, so a consumer *could* re-read it — but the
      // title is what identifies this finding as the same one the provider may
      // also have rendered into its review comment, which is what stops it
      // being counted twice.
      title = provider.parseFindingTitle?.(body) ?? null;
    }
    threads.push({
      authorLogin,
      isResolved: boolField(node, "isResolved"),
      isOutdated: boolField(node, "isOutdated"),
      path: stringField(node, "path"),
      line: numberField(node, "line"),
      url,
      priority,
      title,
      threadId: stringField(node, "id"),
      commentId: null,
    });
  }

  const pageInfo = recordField(reviewThreads, "pageInfo");
  return {
    headRefOid: stringField(pullRequest, "headRefOid"),
    threads,
    hasNextPage: pageInfo !== null && boolField(pageInfo, "hasNextPage"),
    endCursor: pageInfo === null ? null : stringField(pageInfo, "endCursor"),
  };
}
