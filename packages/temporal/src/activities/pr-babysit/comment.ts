/**
 * The babysitter's single status comment per PR. Keyed by a hidden HTML marker
 * so the workflow rewrites ONE comment through its lifecycle (started →
 * awaiting-guidance → done → budget-exhausted → stopped) instead of spamming the
 * thread. Mirrors the pr-review bot's marker-upsert pattern.
 */
import { Octokit } from "octokit";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";

export const BABYSIT_STATUS_MARKER = "<!-- pr-babysit-status -->";

export type PostBabysitStatusInput = {
  owner: string;
  repo: string;
  prNumber: number;
  /** Markdown body (the marker is prepended automatically if absent). */
  body: string;
};

export type PostBabysitStatusResult = {
  commentId: number;
  created: boolean;
};

async function findStatusComment(
  octokit: Octokit,
  input: PostBabysitStatusInput,
): Promise<number | undefined> {
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listComments, {
    owner: input.owner,
    repo: input.repo,
    issue_number: input.prNumber,
    per_page: 100,
  });
  for await (const page of iterator) {
    for (const comment of page.data) {
      if (
        typeof comment.body === "string" &&
        comment.body.startsWith(BABYSIT_STATUS_MARKER)
      ) {
        return comment.id;
      }
    }
  }
  return undefined;
}

export async function postBabysitStatus(
  input: PostBabysitStatusInput,
): Promise<PostBabysitStatusResult> {
  const { token } = await createGitHubAppInstallationToken();
  const octokit = new Octokit({ auth: token });
  const body = input.body.startsWith(BABYSIT_STATUS_MARKER)
    ? input.body
    : `${BABYSIT_STATUS_MARKER}\n\n${input.body}`;

  const existingId = await findStatusComment(octokit, input);
  if (existingId !== undefined) {
    await octokit.rest.issues.updateComment({
      owner: input.owner,
      repo: input.repo,
      comment_id: existingId,
      body,
    });
    return { commentId: existingId, created: false };
  }
  const created = await octokit.rest.issues.createComment({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.prNumber,
    body,
  });
  return { commentId: created.data.id, created: true };
}
