import { createHash } from "node:crypto";
import { z } from "zod";
import { isProviderAuthor, PROVIDERS } from "@shepherdjerred/code-review";
import {
  githubGet,
  graphqlRateLimitError,
  throwIfRateLimited,
} from "@shepherdjerred/code-review/github-request";
import {
  bucketFromHeaders,
  DiskStore,
  githubStateDirectory,
  MemoryStore,
  RateLimitLedger,
  StoreResponseCache,
  type KeyValueStore,
  type RateLimitBucket,
} from "./github/budget.ts";
import {
  PrSchema,
  ReviewSchema,
  RuleSchema,
  RequiredStatusParameters,
  RequiredReviewParameters,
  StatusSchema,
  CheckRunSchema,
  DecisionSchema,
  MemoSchema,
  RulesMemoSchema,
  RateLimitQuerySchema,
  type CiPullRequest,
  type CiReview,
  type CiRules,
  type CommitCheck,
  type PrDecision,
  addLegacyProtection,
  checkRunState,
} from "./github/schemas.ts";
import { captureJson } from "./process.ts";
import { PullRequestSchema } from "#lib/github/schemas.ts";

export const REPOSITORY = "shepherdjerred/monorepo";
const API = "https://api.github.com";
export type GitHubClientOptions = {
  /** Where ETagged bodies, decisions, and rate-limit observations live. */
  store?: KeyValueStore;
  now?: () => number;
};

function timeout(signal?: AbortSignal): AbortSignal {
  return signal === undefined
    ? AbortSignal.timeout(30_000)
    : AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
}

export class GitHubClient {
  /**
   * ETags for reads. `ci wait` re-reads the same PR, checks, and reviews; a
   * revalidated 304 is not charged to the shared REST quota. With a shared
   * store, every toolkit process on the host revalidates the same entries.
   */
  readonly cache: StoreResponseCache;
  readonly ledger: RateLimitLedger;
  readonly store: KeyValueStore;
  /** Names this token in shared state without storing the token. */
  readonly identity: string;
  readonly now: () => number;

  constructor(
    readonly token: string,
    readonly repo: string = REPOSITORY,
    options: GitHubClientOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.store = options.store ?? new MemoryStore();
    this.cache = new StoreResponseCache(this.store);
    this.ledger = new RateLimitLedger(this.store, this.now);
    this.identity = createHash("sha256").update(token).digest("hex");
  }

  /** A client whose cache and budget are shared by every toolkit process on this host. */
  static shared(token: string, repo: string = REPOSITORY): GitHubClient {
    return new GitHubClient(token, repo, {
      store: new DiskStore(githubStateDirectory()),
    });
  }

  /** The newest observation of one bucket in its current window. */
  bucket(resource: "core" | "graphql"): Promise<RateLimitBucket | null> {
    return this.ledger.bucket(this.identity, resource);
  }

  #observe(headers: Headers, resource: string | null = null): Promise<void> {
    return this.ledger.record(
      this.identity,
      bucketFromHeaders(headers, this.now(), resource),
    );
  }

  /**
   * GET a REST path; throws `GitHubRateLimitError` when GitHub refuses on
   * quota. `maxAgeMs` lets a non-final read reuse a body any process stored
   * that recently without asking GitHub at all.
   */
  response(
    path: string,
    signal?: AbortSignal,
    maxAgeMs = 0,
  ): Promise<Response> {
    return githubGet(new URL(path, API), {
      token: this.token,
      cache: this.cache,
      redirect: "error",
      maxAgeMs,
      now: this.now,
      observe: (response) => this.#observe(response.headers),
      signal: timeout(signal),
    });
  }

  async read<T>(
    path: string,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
    maxAgeMs = 0,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await Bun.sleep(
          Bun.env.NODE_ENV === "test" ? 5 : 1000 * 2 ** (attempt - 1),
        );
      }
      const response = await this.response(path, signal, maxAgeMs);
      if (response.ok) {
        return schema.parse(await response.json());
      }
      if (response.status >= 500 && response.status < 600 && attempt < 2) {
        continue;
      }
      throw new Error(
        `GitHub request failed (${String(response.status)}): ${path}`,
      );
    }
    throw new Error(`GitHub request failed: ${path}`);
  }

  async pages<T>(
    path: string,
    schema: z.ZodType<T[]>,
    signal?: AbortSignal,
    maxAgeMs = 0,
  ): Promise<T[]> {
    const output: T[] = [];
    for (let page = 1; ; page++) {
      const separator = path.includes("?") ? "&" : "?";
      const batch = await this.read(
        `${path}${separator}per_page=100&page=${String(page)}`,
        schema,
        signal,
        maxAgeMs,
      );
      output.push(...batch);
      if (batch.length < 100) return output;
    }
  }

  pr(
    number: number,
    signal?: AbortSignal,
    maxAgeMs = 0,
  ): Promise<CiPullRequest> {
    return this.read(
      `/repos/${this.repo}/pulls/${String(number)}`,
      PrSchema,
      signal,
      maxAgeMs,
    );
  }

  /** One GraphQL query; quota refusals, including HTTP 200 ones, throw `GitHubRateLimitError`. */
  async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      redirect: "error",
      signal: timeout(signal),
      body: JSON.stringify({ query, variables }),
    });
    await this.#observe(response.headers, "graphql");
    if (!response.ok) {
      throwIfRateLimited(response, await response.text(), "/graphql");
      throw new Error(`GitHub GraphQL failed (${String(response.status)})`);
    }
    const payload: unknown = await response.json();
    const graphqlErrors = z
      .object({ errors: z.array(z.unknown()) })
      .safeParse(payload);
    if (graphqlErrors.success) {
      const limited = graphqlRateLimitError(
        response,
        graphqlErrors.data.errors,
        "/graphql",
      );
      if (limited !== null) throw limited;
    }
    const result = z
      .object({
        errors: z.array(z.unknown()).optional(),
        data: schema.optional(),
      })
      .parse(payload);
    if (result.errors !== undefined || result.data === undefined)
      throw new Error("GitHub GraphQL returned errors instead of data");
    return result.data;
  }

  async decision(number: number, signal?: AbortSignal): Promise<PrDecision> {
    const [owner, name] = this.repo.split("/");
    const data = await this.graphql(
      "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid baseRefOid reviewDecision}}}",
      { owner, name, number },
      z.object({
        repository: z.object({ pullRequest: DecisionSchema }),
      }),
      signal,
    );
    return data.repository.pullRequest;
  }

  /**
   * The review decision for one PR state. GitHub derives reviewDecision from
   * the reviews, the base rules, and the head; when none of those inputs
   * changed (`inputs` fingerprints them) a decision any process read within
   * `maxAgeMs` is reused instead of spending a GraphQL point. `maxAgeMs` 0
   * always asks GitHub.
   */
  async memoizedDecision(
    number: number,
    inputs: string,
    signal: AbortSignal | undefined,
    maxAgeMs: number,
  ): Promise<PrDecision> {
    const key = `decision\n${this.identity}\n${this.repo}#${String(number)}\n${inputs}`;
    const memo =
      maxAgeMs > 0 ? await this.store.read(key, MemoSchema) : undefined;
    if (memo !== undefined && this.now() - memo.readAt < maxAgeMs)
      return memo.decision;
    const decision = await this.decision(number, signal);
    await this.store.write(key, { readAt: this.now(), decision });
    return decision;
  }

  /**
   * GraphQL points left this window. Uses an observation newer than
   * `maxAgeMs` when one exists; otherwise asks GitHub (one point).
   */
  async graphqlBudget(
    signal?: AbortSignal,
    maxAgeMs = 30_000,
  ): Promise<RateLimitBucket> {
    const known = await this.bucket("graphql");
    if (known !== null && this.now() - known.observedAt < maxAgeMs)
      return known;
    const data = await this.graphql(
      "query{rateLimit{limit remaining used resetAt}}",
      {},
      RateLimitQuerySchema,
      signal,
    );
    return {
      resource: "graphql",
      limit: data.rateLimit.limit,
      remaining: data.rateLimit.remaining,
      used: data.rateLimit.used,
      resetAt: Date.parse(data.rateLimit.resetAt),
      observedAt: this.now(),
    };
  }

  reviews(
    number: number,
    signal?: AbortSignal,
    maxAgeMs = 0,
  ): Promise<CiReview[]> {
    return this.pages(
      `/repos/${this.repo}/pulls/${String(number)}/reviews`,
      z.array(ReviewSchema),
      signal,
      maxAgeMs,
    );
  }

  /**
   * The base branch's merge rules, reused machine-wide for `maxAgeMs`. Rules
   * change rarely, and a repository without legacy protection answers that
   * read with an un-ETagged 404 that GitHub charges every time.
   */
  async memoizedRules(
    branch: string,
    signal: AbortSignal | undefined,
    maxAgeMs: number,
  ): Promise<CiRules> {
    const key = `rules:${this.identity}:${this.repo}:${branch}`;
    const memo =
      maxAgeMs > 0 ? await this.store.read(key, RulesMemoSchema) : undefined;
    if (memo !== undefined && this.now() - memo.readAt < maxAgeMs)
      return memo.rules;
    const rules = await this.rules(branch, signal);
    await this.store.write(key, { readAt: this.now(), rules });
    return rules;
  }

  async rules(
    branch: string,
    signal?: AbortSignal,
    maxAgeMs = 0,
  ): Promise<CiRules> {
    const prefix = `/repos/${this.repo}`;
    const [rules, protection] = await Promise.all([
      this.pages(
        `${prefix}/rules/branches/${encodeURIComponent(branch)}`,
        z.array(RuleSchema),
        signal,
        maxAgeMs,
      ),
      this.response(
        `${prefix}/branches/${encodeURIComponent(branch)}/protection`,
        signal,
        maxAgeMs,
      ),
    ]);
    const result: CiRules = { checks: [], strict: false, approvals: 0 };
    for (const rule of rules) {
      if (rule.type === "required_status_checks") {
        const parameters = RequiredStatusParameters.parse(rule.parameters);
        result.strict ||= parameters.strict_required_status_checks_policy;
        for (const check of parameters.required_status_checks) {
          result.checks.push({
            name: check.context,
            appId:
              check.integration_id === undefined || check.integration_id < 0
                ? null
                : check.integration_id,
          });
        }
      }
      if (rule.type === "pull_request")
        result.approvals = Math.max(
          result.approvals,
          RequiredReviewParameters.parse(rule.parameters)
            .required_approving_review_count,
        );
    }
    await addLegacyProtection(protection, result);
    return result;
  }

  async checks(
    sha: string,
    signal?: AbortSignal,
    maxAgeMs = 0,
  ): Promise<CommitCheck[]> {
    const prefix = `/repos/${this.repo}/commits/${sha}`;
    const [statuses, runs] = await Promise.all([
      this.pages(`${prefix}/statuses`, z.array(StatusSchema), signal, maxAgeMs),
      this.pages(
        `${prefix}/check-runs?filter=latest`,
        z
          .object({ check_runs: z.array(CheckRunSchema) })
          .transform((value) => value.check_runs),
        signal,
        maxAgeMs,
      ),
    ]);
    const latest = new Map<string, CommitCheck>();
    for (const status of statuses) {
      if (!latest.has(status.context))
        latest.set(status.context, {
          name: status.context,
          state:
            status.state === "success"
              ? "pass"
              : status.state === "pending"
                ? "pending"
                : "fail",
          url: status.target_url,
          appId: null,
        });
    }
    return [
      ...latest.values(),
      ...runs
        .filter((run) => run.head_sha === sha)
        .map((run): CommitCheck => ({
          name: run.name,
          state: checkRunState(run.status, run.conclusion),
          url: run.html_url,
          appId: run.app?.id ?? null,
        })),
    ];
  }
}

export function isHumanReview(review: CiReview): boolean {
  return (
    review.user !== null &&
    review.user.type !== "Bot" &&
    !Object.values(PROVIDERS).some((provider) =>
      isProviderAuthor(provider, review.user?.login ?? null),
    )
  );
}

export async function resolvePrNumber(
  number?: string,
  repo: string = REPOSITORY,
): Promise<number> {
  if (number !== undefined)
    return z.coerce.number().int().positive().parse(number);
  const branchResult = Bun.spawnSync(["git", "branch", "--show-current"]);
  const branch =
    branchResult.exitCode === 0 ? branchResult.stdout.toString().trim() : "";
  const args = ["gh", "pr", "view"];
  if (branch.length > 0) args.push(branch);
  args.push(
    "--repo",
    repo,
    "--json",
    "number,title,url,headRefName,headRefOid,baseRefName,state,isDraft,mergeable,reviewDecision",
  );
  const pr = await captureJson(args, PullRequestSchema);
  return pr.number;
}
