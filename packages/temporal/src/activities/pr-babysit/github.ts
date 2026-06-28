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
  /** True when the head branch lives in a fork, not the base repo. */
  isCrossRepository: z.boolean(),
  /** Owner of the repo the head branch lives in (the fork owner for forks). */
  headRepositoryOwner: z.object({ login: z.string() }).nullable(),
});

export type PrSnapshot = {
  prState: PrState;
  headSha: string;
  headRef: string;
  baseRef: string;
  /**
   * True when the head branch lives in a fork. For such PRs `headRef` names a
   * branch in the contributor's fork — it is NOT reachable on the base `origin`,
   * so the babysitter cannot fetch/checkout or push it (see `ensureBabysitWorkdir`).
   */
  isCrossRepository: boolean;
  /** Login of the head repo's owner (the fork owner for forks); null if unknown. */
  headRepoOwner: string | null;
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
      "state,headRefOid,headRefName,baseRefName,isCrossRepository,headRepositoryOwner",
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
    isCrossRepository: parsed.isCrossRepository,
    headRepoOwner: parsed.headRepositoryOwner?.login ?? null,
  };
}

const CheckSchema = z.object({
  name: z.string(),
  bucket: z.string(),
});

/**
 * Read all check + status contexts for the PR. `gh pr checks` exits non-zero
 * when checks are pending/failing (a legitimate answer), so we ignore the exit
 * code and parse stdout. An empty result (no checks reported yet — e.g. right
 * after a push, before Buildkite/status contexts register) returns `[]`, which
 * `classifyChecks` flags as `noChecksReported` and never green, so the loop
 * waits for CI to register instead of falsely reporting the DoD as met.
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

const BranchRuleSchema = z.object({
  type: z.string(),
  parameters: z
    .object({
      required_status_checks: z
        .array(z.object({ context: z.string() }))
        .optional(),
    })
    .nullish(),
});

/**
 * Result of looking up the base branch's required checks. `known: false` means
 * we could NOT determine them (gh error / unparseable response) — the caller
 * must fail CLOSED (never report CI green on an unverified required-check set),
 * not fall back to "no required checks". `known: true` with an empty `contexts`
 * is the legitimate "this branch genuinely has no required checks" case.
 */
export type RequiredChecksResult =
  | { known: true; contexts: string[] }
  | { known: false; reason: string };

export type RequiredCtx = {
  owner: string;
  repo: string;
  baseRef: string;
  env?: Record<string, string>;
};

/** Required contexts from the modern rulesets endpoint (`/rules/branches/<branch>`). */
async function rulesetRequiredContexts(
  ctx: RequiredCtx,
): Promise<RequiredChecksResult> {
  const result = await capture(
    [
      "gh",
      "api",
      `repos/${ctx.owner}/${ctx.repo}/rules/branches/${ctx.baseRef}`,
    ],
    ctx.env === undefined ? {} : { env: ctx.env },
  );
  if (result.exitCode !== 0) {
    return {
      known: false,
      reason: `gh api rules/branches/${ctx.baseRef} failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch (error: unknown) {
    return {
      known: false,
      reason: `failed to parse branch rules JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const rules = z.array(BranchRuleSchema).safeParse(json);
  if (!rules.success) {
    return {
      known: false,
      reason: `unexpected branch rules shape: ${rules.error.message}`,
    };
  }
  const contexts = new Set<string>();
  for (const rule of rules.data) {
    if (rule.type !== "required_status_checks") {
      continue;
    }
    for (const check of rule.parameters?.required_status_checks ?? []) {
      contexts.add(check.context);
    }
  }
  return { known: true, contexts: [...contexts] };
}

const ClassicProtectionSchema = z.object({
  contexts: z.array(z.string()).optional(),
  checks: z.array(z.object({ context: z.string() })).optional(),
});

/**
 * Required contexts from CLASSIC branch protection
 * (`/branches/<branch>/protection/required_status_checks`). A 404 means the
 * branch has no classic protection (legitimately empty); any other failure is
 * "unknown" so the caller fails closed.
 */
async function classicRequiredContexts(
  ctx: RequiredCtx,
): Promise<RequiredChecksResult> {
  const result = await capture(
    [
      "gh",
      "api",
      `repos/${ctx.owner}/${ctx.repo}/branches/${ctx.baseRef}/protection/required_status_checks`,
    ],
    ctx.env === undefined ? {} : { env: ctx.env },
  );
  if (result.exitCode !== 0) {
    if (/not protected|HTTP 404|\b404\b/i.test(result.stderr)) {
      return { known: true, contexts: [] };
    }
    return {
      known: false,
      reason: `gh api classic protection failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch (error: unknown) {
    return {
      known: false,
      reason: `failed to parse classic protection JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const parsed = ClassicProtectionSchema.safeParse(json);
  if (!parsed.success) {
    return {
      known: false,
      reason: `unexpected classic protection shape: ${parsed.error.message}`,
    };
  }
  const contexts = new Set<string>([
    ...(parsed.data.contexts ?? []),
    ...(parsed.data.checks ?? []).map((c) => c.context),
  ]);
  return { known: true, contexts: [...contexts] };
}

/**
 * Required status-check contexts for the base branch — the union of BOTH the
 * modern rulesets endpoint AND classic branch protection, since a repo may use
 * either (or both). Returns `{ known: false }` if EITHER source can't be
 * determined (real error, not a 404), so the caller fails closed rather than
 * silently dropping the required-check gate.
 */
export async function getRequiredCheckContexts(
  ctx: RequiredCtx,
): Promise<RequiredChecksResult> {
  const [ruleset, classic] = await Promise.all([
    rulesetRequiredContexts(ctx),
    classicRequiredContexts(ctx),
  ]);
  if (!ruleset.known) {
    return ruleset;
  }
  if (!classic.known) {
    return classic;
  }
  const contexts = new Set<string>([...ruleset.contexts, ...classic.contexts]);
  return { known: true, contexts: [...contexts].toSorted() };
}
