/**
 * GitHub read helpers for the babysitter, via the `gh` CLI. `gh` honors
 * `GH_TOKEN` from the env, so these work identically with the user's local auth
 * (Phase-0 PoC) and with a GitHub App installation token in the worker. Each
 * helper returns data already normalized for the pure `dod.ts` classifiers.
 */
import { z } from "zod/v4";
import { capture } from "./exec.ts";
import type {
  NormalizedCheck,
  NormalizedReviewThread,
} from "#shared/pr-babysit/dod.ts";
import { type PrState } from "#shared/pr-babysit/types.ts";

export type BabysitGhContext = {
  owner: string;
  repo: string;
  prNumber: number;
  /** Extra env (e.g. GH_TOKEN) merged into the gh invocations. */
  env?: Record<string, string>;
};

function repoSlug(ctx: BabysitGhContext): string {
  return `${ctx.owner}/${ctx.repo}`;
}

const PrViewSchema = z.object({
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  headRefOid: z.string().min(1),
  headRefName: z.string().min(1),
  baseRefName: z.string().min(1),
});

export type PrSnapshot = {
  prState: PrState;
  headSha: string;
  headRef: string;
  baseRef: string;
};

export async function getPrSnapshot(
  ctx: BabysitGhContext,
): Promise<PrSnapshot> {
  const result = await capture(
    [
      "gh",
      "pr",
      "view",
      String(ctx.prNumber),
      "--repo",
      repoSlug(ctx),
      "--json",
      "state,headRefOid,headRefName,baseRefName",
    ],
    ctx.env === undefined ? {} : { env: ctx.env },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `gh pr view #${String(ctx.prNumber)} failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`,
    );
  }
  const parsed = PrViewSchema.parse(JSON.parse(result.stdout));
  const prState: PrState =
    parsed.state === "MERGED"
      ? "merged"
      : parsed.state === "CLOSED"
        ? "closed"
        : "open";
  return {
    prState,
    headSha: parsed.headRefOid,
    headRef: parsed.headRefName,
    baseRef: parsed.baseRefName,
  };
}

const CheckSchema = z.object({
  name: z.string(),
  bucket: z.string(),
});

/**
 * Read all check + status contexts for the PR. `gh pr checks` exits non-zero
 * when checks are pending/failing (a legitimate answer), so we ignore the exit
 * code and parse stdout. An empty result (no checks reported yet) returns `[]`,
 * which the classifier treats as green — see the fresh-push caveat in the plan
 * (the workflow waits for a CI signal before re-evaluating after a push).
 */
export async function getChecks(
  ctx: BabysitGhContext,
): Promise<NormalizedCheck[]> {
  const result = await capture(
    [
      "gh",
      "pr",
      "checks",
      String(ctx.prNumber),
      "--repo",
      repoSlug(ctx),
      "--json",
      "name,bucket,state",
    ],
    ctx.env === undefined ? {} : { env: ctx.env },
  );
  const trimmed = result.stdout.trim();
  if (trimmed.length === 0 || trimmed === "[]") {
    return [];
  }
  const parsed = z.array(CheckSchema).safeParse(JSON.parse(trimmed));
  if (!parsed.success) {
    throw new Error(
      `failed to parse gh pr checks output: ${parsed.error.message}`,
    );
  }
  return parsed.data.map((c) => ({ name: c.name, bucket: c.bucket }));
}

const REVIEW_THREADS_QUERY = `query($owner:String!,$repo:String!,$pr:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$pr){
      reviewThreads(first:100){
        nodes{
          id
          isResolved
          comments(first:1){ nodes{ author{login} body url } }
        }
      }
    }
  }
}`;

const ReviewThreadsResponseSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        reviewThreads: z.object({
          nodes: z.array(
            z.object({
              id: z.string(),
              isResolved: z.boolean(),
              comments: z.object({
                nodes: z.array(
                  z.object({
                    author: z.object({ login: z.string() }).nullable(),
                    body: z.string().nullable(),
                    url: z.string().nullable(),
                  }),
                ),
              }),
            }),
          ),
        }),
      }),
    }),
  }),
});

/**
 * Read the PR's review threads via GraphQL (the `--repo` flag is broken for
 * `gh api graphql`; pass owner/repo as variables instead). Normalizes each
 * thread to its first comment's author/body/url for the classifier.
 *
 * Note: this covers diff-anchored review threads (the resolvable gate). Greptile
 * "comments outside of diff" that arrive as un-anchored review/issue comments
 * are a documented Phase-1 follow-up (see the babysit todo).
 */
export async function getReviewThreads(
  ctx: BabysitGhContext,
): Promise<NormalizedReviewThread[]> {
  const result = await capture(
    [
      "gh",
      "api",
      "graphql",
      "-F",
      `owner=${ctx.owner}`,
      "-F",
      `repo=${ctx.repo}`,
      "-F",
      `pr=${String(ctx.prNumber)}`,
      "-f",
      `query=${REVIEW_THREADS_QUERY}`,
    ],
    ctx.env === undefined ? {} : { env: ctx.env },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `gh api graphql reviewThreads failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`,
    );
  }
  const parsed = ReviewThreadsResponseSchema.parse(JSON.parse(result.stdout));
  return parsed.data.repository.pullRequest.reviewThreads.nodes.map((node) => {
    const first = node.comments.nodes[0];
    return {
      id: node.id,
      isResolved: node.isResolved,
      author: first?.author?.login ?? null,
      body: first?.body ?? null,
      ...(first?.url == null ? {} : { url: first.url }),
    };
  });
}
