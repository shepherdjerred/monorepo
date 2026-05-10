/**
 * Narrow function-based surface of the Octokit endpoints this helper uses.
 * Defined structurally (not via `Octokit["rest"]["issues"]["listComments"]`)
 * so tests can pass plain async functions without `as` assertions to bridge
 * Octokit's richly-branded endpoint method types.
 *
 * A thin adapter at the call site wraps a real Octokit into this shape;
 * because the shape is pure async functions, structural compatibility holds.
 */
export type OctokitForUpsert = {
  listComments: (params: {
    owner: string;
    repo: string;
    issue_number: number;
    per_page: number;
  }) => Promise<{ data: readonly { id: number; body?: string | null }[] }>;
  createComment: (params: {
    owner: string;
    repo: string;
    issue_number: number;
    body: string;
  }) => Promise<{ data: { id: number; html_url: string } }>;
  updateComment: (params: {
    owner: string;
    repo: string;
    comment_id: number;
    body: string;
  }) => Promise<{ data: { id: number; html_url: string } }>;
  paginateListComments: (params: {
    owner: string;
    repo: string;
    issue_number: number;
    per_page: number;
  }) => AsyncIterable<{
    data: readonly { id: number; body?: string | null }[];
  }>;
};

export type UpsertResult =
  | { action: "created"; commentId: number; htmlUrl: string }
  | { action: "updated"; commentId: number; htmlUrl: string };

export type UpsertSummaryCommentInput = {
  octokit: OctokitForUpsert;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  marker: string;
};

/**
 * Find a PR issue comment containing `marker` and edit it in place; otherwise
 * create a new comment. Idempotent across re-runs of the same PR push because
 * the marker uniquely identifies the bot's summary comment.
 *
 * Walks paginated comments until either the marker is found or the list is
 * exhausted — first match wins, which means if two bot instances ever race
 * (shouldn't happen with the workflow-ID-keyed idempotency, but be defensive),
 * the oldest comment is the one that gets edited, leaving any duplicates
 * visible for cleanup.
 */
export async function upsertSummaryComment(
  input: UpsertSummaryCommentInput,
): Promise<UpsertResult> {
  const { octokit, owner, repo, prNumber, body, marker } = input;

  if (!body.includes(marker)) {
    throw new Error(
      `Summary body does not contain the required marker ${marker}; refusing to post`,
    );
  }

  const existing = await findCommentWithMarker({
    octokit,
    owner,
    repo,
    prNumber,
    marker,
  });

  if (existing !== undefined) {
    const updated = await octokit.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    return {
      action: "updated",
      commentId: updated.data.id,
      htmlUrl: updated.data.html_url,
    };
  }

  const created = await octokit.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
  return {
    action: "created",
    commentId: created.data.id,
    htmlUrl: created.data.html_url,
  };
}

type FindInput = {
  octokit: OctokitForUpsert;
  owner: string;
  repo: string;
  prNumber: number;
  marker: string;
};

type ExistingComment = {
  id: number;
  body: string;
};

async function findCommentWithMarker(
  input: FindInput,
): Promise<ExistingComment | undefined> {
  const { octokit, owner, repo, prNumber, marker } = input;
  const iterator = octokit.paginateListComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });
  for await (const page of iterator) {
    for (const c of page.data) {
      if (typeof c.body === "string" && c.body.includes(marker)) {
        return { id: c.id, body: c.body };
      }
    }
  }
  return undefined;
}
